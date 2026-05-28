import crypto from "crypto";

export function encryptAes256Gcm(
  key: string,
  nonce: string,
  associatedData: string,
  plaintext: string
): string {
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "utf-8"), Buffer.from(nonce, "utf-8"));
  cipher.setAAD(Buffer.from(associatedData, "utf-8"));
  const encrypted = cipher.update(plaintext);
  const final = cipher.final();
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, final, tag]).toString("base64");
}

export function createWeChatMockFetch(options: {
  apiV3Key: string;
  platformCertSerial: string;
  platformCertPem: string;
}) {
  let tokenRequestCount = 0;
  let jscode2sessionRequestCount = 0;
  let getPhoneRequestCount = 0;
  let subscribeRequestCount = 0;
  let jsapiPayRequestCount = 0;
  let queryOrderRequestCount = 0;
  let certsRequestCount = 0;

  const mockFetch = async (input: any, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const url = new URL(input.toString());
    const path = url.pathname;
    const searchParams = url.searchParams;

    if (path === "/cgi-bin/token") {
      tokenRequestCount++;
      const appid = searchParams.get("appid");
      if (appid === "invalid_appid") {
        return new Response(JSON.stringify({ errcode: 40013, errmsg: "invalid appid" }), { status: 200 });
      }
      if (appid === "slow_appid") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 700);
          if (signal) {
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      }
      if (appid === "timeout_appid") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 1200);
          if (signal) {
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      }
      if (appid === "slow_refresh_6s") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5500);
          if (signal) {
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      }
      return new Response(JSON.stringify({ access_token: "mock_access_token_xyz", expires_in: 7200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/sns/jscode2session") {
      jscode2sessionRequestCount++;
      const code = searchParams.get("js_code");
      if (code === "invalid_code") {
        return new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ openid: "mock_openid_123", session_key: "mock_session_key_456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/wxa/business/getuserphonenumber") {
      getPhoneRequestCount++;
      const body = JSON.parse(init?.body as string);
      if (body.code === "invalid_code") {
        return new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          errcode: 0,
          errmsg: "ok",
          phone_info: {
            phoneNumber: "13800000000",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (path === "/cgi-bin/message/subscribe/send") {
      subscribeRequestCount++;
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/v3/pay/transactions/jsapi") {
      jsapiPayRequestCount++;
      return new Response(JSON.stringify({ prepay_id: "mock_prepay_id_jsapi" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path.startsWith("/v3/pay/transactions/out-trade-no/")) {
      queryOrderRequestCount++;
      return new Response(
        JSON.stringify({
          appid: "mock_app_id",
          mchid: "mock_mch_id",
          out_trade_no: "order_123",
          transaction_id: "tx_123",
          trade_type: "JSAPI",
          trade_state: "SUCCESS",
          trade_state_desc: "success",
          bank_type: "CMC",
          success_time: "2026-05-28T18:00:00+08:00",
          payer: {
            openid: "mock_openid_123",
          },
          amount: {
            total: 990,
            currency: "CNY",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (path === "/v3/certificates") {
      certsRequestCount++;
      const nonce = crypto.randomBytes(12).toString("hex").slice(0, 12);
      const associatedData = "certificate";
      const ciphertext = encryptAes256Gcm(
        options.apiV3Key,
        nonce,
        associatedData,
        options.platformCertPem
      );

      return new Response(
        JSON.stringify({
          data: [
            {
              serial_no: options.platformCertSerial,
              effective_time: "2026-01-01T00:00:00+08:00",
              expire_time: "2036-01-01T00:00:00+08:00",
              encrypt_certificate: {
                algorithm: "AEAD_AES_256_GCM",
                nonce,
                associated_data: associatedData,
                ciphertext,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    mockFetch,
    getCounts: () => ({
      tokenRequestCount,
      jscode2sessionRequestCount,
      getPhoneRequestCount,
      subscribeRequestCount,
      jsapiPayRequestCount,
      queryOrderRequestCount,
      certsRequestCount,
    }),
    resetCounts: () => {
      tokenRequestCount = 0;
      jscode2sessionRequestCount = 0;
      getPhoneRequestCount = 0;
      subscribeRequestCount = 0;
      jsapiPayRequestCount = 0;
      queryOrderRequestCount = 0;
      certsRequestCount = 0;
    },
  };
}
