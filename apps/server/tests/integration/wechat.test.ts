import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import crypto from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { createTestHarness } from "../helpers/harness.js";
import { createWeChatMockFetch, encryptAes256Gcm } from "../helpers/wechat-mock.js";
import {
  initWeChatService,
  getWeChatService,
  getTemplateConfig,
  WeChatApiError,
  notify,
  WECHAT_TEMPLATES,
  WeChatAccessTokenManager
} from "../../src/wechat/index.js";
import {
  QueueRegistry,
  WorkerRegistry,
  createQueueConnection,
  registerPayloadSchema
} from "../../src/queue/index.js";
import { wechatSubscribeJobSchema } from "@yikey/shared";
import { QueueTestHarness } from "./queue/harness.js";
import { logger } from "../../src/logger/index.js";

describe("WeChat Integration Tests", () => {
  const harness = createTestHarness();
  
  // Test-specific keys and serials for WeChat Pay
  const apiV3Key = "mock_api_v3_key_32_chars_long_12";
  const platformCertSerial = "mock_platform_cert_serial_123456";
  let platformCertPem: string;
  let testPrivateKeyPem: string;
  let wechatPrivateKey: crypto.KeyObject;
  let wechatPublicKey: crypto.KeyObject;

  // WeChat Mock Fetch instance
  let mockFetchHelper: ReturnType<typeof createWeChatMockFetch>;

  // Queue resources
  let queueRedisConnection: any;
  let pgPool: pg.Pool;
  const fileId = createId().substring(0, 8);
  const queuePrefix = `bq_wechat_${fileId}`;

  beforeAll(async () => {
    // Generate RSA key pair for simulating WeChat Pay signatures
    const keypair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    wechatPrivateKey = keypair.privateKey;
    wechatPublicKey = keypair.publicKey;

    platformCertPem = wechatPublicKey.export({ type: "spki", format: "pem" }).toString();
    testPrivateKeyPem = wechatPrivateKey.export({ type: "pkcs8", format: "pem" }).toString();

    // Create mock fetch helper
    mockFetchHelper = createWeChatMockFetch({
      apiV3Key,
      platformCertSerial,
      platformCertPem,
    });

    // Initialize BullMQ Queue registries
    const redisUrl = process.env.TEST_REDIS_URL;
    const pgUrl = process.env.TEST_DATABASE_URL;
    if (!redisUrl || !pgUrl) {
      throw new Error("TEST_REDIS_URL or TEST_DATABASE_URL is missing.");
    }
    queueRedisConnection = createQueueConnection(redisUrl);
    pgPool = new pg.Pool({ connectionString: pgUrl, max: 2 });
    
    // Set up Queue/Worker connection
    QueueRegistry.setConnection(queueRedisConnection);
    WorkerRegistry.setConnection(queueRedisConnection, pgPool);

    // Register notify schema
    registerPayloadSchema("notify:wechat-subscribe", wechatSubscribeJobSchema);

    // Register mock event template dynamically for testing
    WECHAT_TEMPLATES["mock:event"] = {
      event: "mock:event",
      templateId: "mock-template-id",
      buildData: (data: { message: string }) => ({
        thing1: { value: data.message },
      }),
    };
  });

  afterAll(async () => {
    // Cleanup BullMQ connections and test keys
    await WorkerRegistry.closeAll();
    await QueueRegistry.closeAll();
    if (queueRedisConnection) {
      const keys = await queueRedisConnection.keys(`*${queuePrefix}*`);
      if (keys.length > 0) {
        await queueRedisConnection.del(...keys);
      }
      await queueRedisConnection.quit();
    }
    if (pgPool) {
      await pgPool.end();
    }
  });

  beforeEach(async () => {
    mockFetchHelper.resetCounts();

    // Clear access token and lock keys in the isolated Redis namespace for each test
    await harness.redis.del("wechat:access_token");
    await harness.redis.del("wechat:access_token:lock");

    // Initialize WeChatService with the mock fetch
    initWeChatService(harness.redis, {
      apiBaseUrl: "https://api.weixin.qq.com",
      payBaseUrl: "https://api.mch.weixin.qq.com",
      httpClient: mockFetchHelper.mockFetch,
    });

    // Override the pay private key and other config for testing inside getWeChatService().pay
    const service = getWeChatService();
    (service.pay as any).privateKey = testPrivateKeyPem;
    (service.pay as any).apiV3Key = apiV3Key;
    (service.pay as any).certSerialNo = platformCertSerial;
  });

  describe("access_token Manager", () => {
    it("should fetch access_token and cache it in Redis", async () => {
      const service = getWeChatService();
      
      // First call: misses cache, fetches from WeChat
      const token1 = await service.tokenManager.getAccessToken();
      expect(token1).toBe("mock_access_token_xyz");
      expect(mockFetchHelper.getCounts().tokenRequestCount).toBe(1);

      // Second call: hits cache, does not fetch from WeChat
      const token2 = await service.tokenManager.getAccessToken();
      expect(token2).toBe("mock_access_token_xyz");
      expect(mockFetchHelper.getCounts().tokenRequestCount).toBe(1);
    });

    it("should prevent stampede by locking concurrent refreshes", async () => {
      const service = getWeChatService();

      // Trigger 5 concurrent requests
      const tokens = await Promise.all([
        service.tokenManager.getAccessToken(),
        service.tokenManager.getAccessToken(),
        service.tokenManager.getAccessToken(),
        service.tokenManager.getAccessToken(),
        service.tokenManager.getAccessToken(),
      ]);

      // All returned tokens should be correct
      tokens.forEach((t) => expect(t).toBe("mock_access_token_xyz"));
      
      // Only 1 request should have been sent to WeChat Pay
      expect(mockFetchHelper.getCounts().tokenRequestCount).toBe(1);
    });

    it("should only release lock if owner token matches (Lua compare-and-delete)", async () => {
      const service = getWeChatService();
      const manager = service.tokenManager;
      const lockKey = "wechat:access_token:lock";

      // Acquire lock for owner A
      const ownerA = "owner_a";
      await harness.redis.set(lockKey, ownerA);

      // Attempt to release lock using owner B (should fail/do nothing)
      await (manager as any).releaseLock("owner_b");

      // Verify lock is still held by owner A
      let lockVal = await harness.redis.get(lockKey);
      expect(lockVal).toBe(ownerA);

      // Release lock using owner A (should succeed)
      await (manager as any).releaseLock(ownerA);
      lockVal = await harness.redis.get(lockKey);
      expect(lockVal).toBeNull();
    });

    it("should not duplicate fetch when a second request is initiated during an ongoing slow refresh", async () => {
      const service = getWeChatService();
      const customManager = new WeChatAccessTokenManager(
        harness.redis,
        service.client,
        "slow_appid",
        "slow_secret"
      );

      // Start the first slow request
      const fetchPromise1 = customManager.getAccessToken();

      // Wait 300ms, then start the second request
      await new Promise((resolve) => setTimeout(resolve, 300));
      const fetchPromise2 = customManager.getAccessToken();

      const [token1, token2] = await Promise.all([fetchPromise1, fetchPromise2]);
      expect(token1).toBe("mock_access_token_xyz");
      expect(token2).toBe("mock_access_token_xyz");

      // Verify only 1 fetch was performed
      expect(mockFetchHelper.getCounts().tokenRequestCount).toBe(1);
    });

    it("should abort the request and release the lock if the fetch exceeds the timeout (less than lock TTL)", async () => {
      const service = getWeChatService();

      const customManager1 = new WeChatAccessTokenManager(
        harness.redis,
        service.client,
        "timeout_appid",
        "slow_secret"
      );
      // Set lock TTL to 3 seconds, which makes timeout 1 second
      customManager1.lockTtl = 3;

      const customManager2 = new WeChatAccessTokenManager(
        harness.redis,
        service.client,
        "timeout_appid",
        "slow_secret"
      );
      // Keep default lock TTL (10 seconds, timeout = 8 seconds)

      // Start request 1 (aborts at 1s because fetch takes 1.2s)
      const fetchPromise1 = customManager1.getAccessToken();

      // Wait 500ms
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Start request 2 (succeeds because its timeout is 8s)
      const fetchPromise2 = customManager2.getAccessToken();

      // Assert that request 1 throws a timeout/abort error
      await expect(fetchPromise1).rejects.toThrow();

      // Assert that request 2 succeeds
      const token2 = await fetchPromise2;
      expect(token2).toBe("mock_access_token_xyz");

      // Total token requests must be 2 (1 aborted, 1 successful), and they did NOT run concurrently
      expect(mockFetchHelper.getCounts().tokenRequestCount).toBe(2);

      // The lock should be released after both complete
      const lockVal = await harness.redis.get("wechat:access_token:lock");
      expect(lockVal).toBeNull();
    });

    it("should allow concurrent requests to wait and succeed even with a 6-second slow refresh if lockTtl is scaled up", async () => {
      const service = getWeChatService();
      const customManager = new WeChatAccessTokenManager(
        harness.redis,
        service.client,
        "slow_refresh_6s",
        "slow_secret"
      );

      // Set lock TTL to 8 seconds, which makes refresh timeout 6 seconds.
      // Dynamic attempts calculation: (8 + 1) * 10 = 90 attempts (9.0 seconds), polled every 100ms.
      customManager.lockTtl = 8;

      // Start the slow getAccessToken call (takes 6s)
      const fetchPromise1 = customManager.getAccessToken();

      // Wait 500ms, then start a second getAccessToken call
      await new Promise((resolve) => setTimeout(resolve, 500));
      const fetchPromise2 = customManager.getAccessToken();

      const [token1, token2] = await Promise.all([fetchPromise1, fetchPromise2]);
      expect(token1).toBe("mock_access_token_xyz");
      expect(token2).toBe("mock_access_token_xyz");

      // Verify that the second request waited and succeeded on the first refresh's cached value
      expect(mockFetchHelper.getCounts().tokenRequestCount).toBe(1);
    }, 15000);
  });

  describe("code2Session Login Wrapper", () => {
    it("should return openid and sessionKey for a valid code", async () => {
      const service = getWeChatService();
      const res = await service.login.code2Session("valid_code");
      expect(res.openid).toBe("mock_openid_123");
      expect(res.sessionKey).toBe("mock_session_key_456");
      expect(mockFetchHelper.getCounts().jscode2sessionRequestCount).toBe(1);
    });

    it("should throw WeChatApiError for an invalid code", async () => {
      const service = getWeChatService();
      await expect(service.login.code2Session("invalid_code")).rejects.toThrow(WeChatApiError);
      expect(mockFetchHelper.getCounts().jscode2sessionRequestCount).toBe(1);
    });
  });

  describe("getPhoneNumber Wrapper", () => {
    it("should return the phone number and redact logging", async () => {
      const service = getWeChatService();
      const loggerSpy = vi.spyOn(logger, "info");

      const phone = await service.phone.getPhoneNumber("valid_code");
      expect(phone).toBe("13800000000");

      // Verify log messages redact phone numbers
      const calls = loggerSpy.mock.calls;
      const phoneLogged = calls.some((call) => JSON.stringify(call).includes("13800000000"));
      expect(phoneLogged).toBe(false);

      const maskedLogged = calls.some((call) => JSON.stringify(call).includes("138****0000"));
      expect(maskedLogged).toBe(true);

      loggerSpy.mockRestore();
    });
  });

  describe("Subscribe Message Framework", () => {
    beforeEach(() => {
      // Clean registered queues & workers for each test to avoid collisions
      try {
        QueueRegistry.register("notify:wechat-subscribe", { prefix: queuePrefix });
      } catch (err) {
        logger.debug({ err }, "Queue might already be registered");
      }
    });

    it("should reject unregistered template events early", async () => {
      await expect(notify.send("invalid-event", "user123", { message: "hi" })).rejects.toThrow(
        "WeChat template for event 'invalid-event' is not registered"
      );
    });

    it("should enqueue a job and trigger the worker processor", async () => {
      const service = getWeChatService();

      // Register the worker processor for the test prefix
      const worker = WorkerRegistry.register(
        "notify:wechat-subscribe",
        async (payload) => {
          const templateConfig = getTemplateConfig(payload.event);
          const formattedData = templateConfig.buildData(payload.data);
          await service.subscribe.sendSubscribeMessage({
            touser: payload.touser,
            templateId: templateConfig.templateId,
            data: formattedData,
          });
        },
        undefined,
        { prefix: queuePrefix }
      );

      // Call notify.send to trigger
      const result = await notify.send("mock:event", "user_openid_1", { message: "Hello WeChat!" });
      expect(result).toBe(true);

      // Verify job enters queue
      const waiting = await QueueTestHarness.getWaitingJobs("notify:wechat-subscribe");
      expect(waiting.length).toBe(1);
      const job = waiting[0];
      expect(job.data.event).toBe("mock:event");
      expect(job.data.touser).toBe("user_openid_1");

      // Drive worker to process job
      const processRes = await QueueTestHarness.waitForWorkerJob(worker, job);
      expect(processRes.status).toBe("completed");

      // Verify WeChat fetch call was invoked
      expect(mockFetchHelper.getCounts().subscribeRequestCount).toBe(1);
    });

    it("should deduplicate events sent to the same user within 5 minutes", async () => {
      // Clear key just in case
      await harness.redis.del("notify:dedup:mock:event:user_openid_dedup");

      // 1. First trigger: success
      const res1 = await notify.send("mock:event", "user_openid_dedup", { message: "First message" });
      expect(res1).toBe(true);

      // 2. Second trigger: duplicate, should be skipped
      const res2 = await notify.send("mock:event", "user_openid_dedup", { message: "Second message" });
      expect(res2).toBe(false);

      // Verify only 1 job is in queue (could be in any state depending on worker timing)
      const queue = QueueRegistry.get("notify:wechat-subscribe");
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
      ]);
      const jobs = [...waiting, ...active, ...completed, ...failed].filter(
        (j) => j.data?.touser === "user_openid_dedup"
      );
      expect(jobs.length).toBe(1);
    });
  });

  describe("WeChat Pay Integration", () => {
    it("should execute JSAPI unified order and return pay config", async () => {
      const service = getWeChatService();
      
      const payParams = await service.pay.unifiedOrder({
        description: "VIP Membership Upgrade",
        outTradeNo: "trade_123456",
        notifyUrl: "https://yikeyue.com/api/pay/callback",
        amount: 990,
        openid: "mock_openid_123",
      });

      expect(payParams.timeStamp).toBeDefined();
      expect(payParams.nonceStr).toBeDefined();
      expect(payParams.package).toBe("prepay_id=mock_prepay_id_jsapi");
      expect(payParams.signType).toBe("RSA");
      expect(payParams.paySign).toBeDefined();

      expect(mockFetchHelper.getCounts().jsapiPayRequestCount).toBe(1);
    });

    it("should query order from WeChat Pay and return status", async () => {
      const service = getWeChatService();
      
      const order = await service.pay.queryOrder("order_123");
      expect(order.out_trade_no).toBe("order_123");
      expect(order.trade_state).toBe("SUCCESS");
      expect(order.amount.total).toBe(990);

      expect(mockFetchHelper.getCounts().queryOrderRequestCount).toBe(1);
    });

    it("should verify and decrypt callback successfully", async () => {
      const service = getWeChatService();

      // 1. Construct callback cipher text
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = crypto.randomBytes(16).toString("hex");
      
      const payload = {
        appid: "mock_app_id",
        mchid: "mock_mch_id",
        out_trade_no: "order_cb_123",
        transaction_id: "tx_cb_123",
        trade_type: "JSAPI",
        trade_state: "SUCCESS",
        trade_state_desc: "success",
        bank_type: "CMC",
        success_time: "2026-05-28T18:00:00+08:00",
        payer: {
          openid: "mock_openid_cb_123",
        },
        amount: {
          total: 990,
          currency: "CNY",
        },
      };

      const ciphertext = encryptAes256Gcm(
        apiV3Key,
        "mock_nonce_99",
        "transaction",
        JSON.stringify(payload)
      );

      const rawBody = JSON.stringify({
        resource: {
          algorithm: "AEAD_AES_256_GCM",
          ciphertext,
          associated_data: "transaction",
          nonce: "mock_nonce_99",
        },
      });

      // 2. Sign callback message using wechat private key (representing WeChat Pay server signing it)
      const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
      const signature = crypto.createSign("RSA-SHA256").update(message).sign(wechatPrivateKey, "base64");

      const headers = {
        "wechatpay-timestamp": timestamp,
        "wechatpay-nonce": nonce,
        "wechatpay-signature": signature,
        "wechatpay-serial": platformCertSerial,
      };

      // 3. Verify callback decryption
      const result = await service.pay.verifyAndDecryptCallback(headers, rawBody);
      expect(result.out_trade_no).toBe("order_cb_123");
      expect(result.trade_state).toBe("SUCCESS");
      expect(result.payer.openid).toBe("mock_openid_cb_123");
      expect(result.amount.total).toBe(990);
    });

    it("should throw error for invalid signature on callback", async () => {
      const service = getWeChatService();

      const headers = {
        "wechatpay-timestamp": "12345",
        "wechatpay-nonce": "abc",
        "wechatpay-signature": "invalid_signature",
        "wechatpay-serial": platformCertSerial,
      };

      const rawBody = JSON.stringify({
        resource: {
          algorithm: "AEAD_AES_256_GCM",
          ciphertext: "abc",
          associated_data: "transaction",
          nonce: "nonce",
        },
      });

      await expect(service.pay.verifyAndDecryptCallback(headers, rawBody)).rejects.toThrow();
    });
  });
});
