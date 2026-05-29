import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { createDb, DatabaseInstance } from "../../src/db/index.js";
import { createRedisClient, RedisClient } from "../../src/redis.js";
import { createId } from "@paralleldrive/cuid2";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "../../src/app.js";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Proxies an ioredis client to automatically prepend a prefix to keys.
 * Design Invariant: 10.3 - Transparent Redis key prefixing for test isolation.
 */
function createPrefixedRedisProxy(redis: RedisClient, prefix: string): RedisClient {
  const keyCommands = new Set(["get", "set", "del", "incr", "expire", "ttl", "exists"]);

  return new Proxy(redis, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original === "function" && typeof prop === "string") {
        const cmd = prop.toLowerCase();
        if (cmd === "eval") {
          return function (...args: any[]) {
            const numKeys = typeof args[1] === "number" ? args[1] : parseInt(args[1], 10);
            if (Number.isInteger(numKeys)) {
              for (let i = 0; i < numKeys; i++) {
                if (typeof args[2 + i] === "string") {
                  args[2 + i] = `${prefix}${args[2 + i]}`;
                }
              }
            }
            return original.apply(target, args);
          };
        }
        if (cmd === "del") {
          return function (...args: any[]) {
            const prefixedArgs = args.map((arg) => (typeof arg === "string" ? `${prefix}${arg}` : arg));
            return original.apply(target, prefixedArgs);
          };
        }
        if (keyCommands.has(cmd)) {
          return function (...args: any[]) {
            if (args.length > 0 && typeof args[0] === "string") {
              args[0] = `${prefix}${args[0]}`;
            }
            return original.apply(target, args);
          };
        }
        return original.bind(target);
      }
      return original;
    },
  });
}

/**
 * API Integration Test Harness.
 * Design Invariants:
 * - 10.3: Per-file isolated DB schema & schema dropping, Redis namespace isolation.
 * - 10.4: Per-test transaction rollback (BEGIN -> inject c.var.db -> ROLLBACK).
 * - 10.5: Hono in-process c.req.request() client, clock injection, test token capability.
 */
export function createTestHarness() {
  const fileId = createId().substring(0, 8);
  const schemaName = `test_${fileId}`;
  const redisPrefix = `test:${fileId}:`;

  let pool: pg.Pool;
  let rawRedis: RedisClient;
  let redis: RedisClient;
  let testClient: pg.PoolClient;
  let db: DatabaseInstance;
  let app: any;
  let testTime = new Date();

  let resolveTx: (() => void) | undefined;
  let txPromise: Promise<void> | undefined;
  let transactionPromise: Promise<any> | undefined;

  beforeAll(async () => {
    const pgUrl = process.env.TEST_DATABASE_URL;
    const redisUrl = process.env.TEST_REDIS_URL;
    if (!pgUrl || !redisUrl) {
      throw new Error("TEST_DATABASE_URL or TEST_REDIS_URL is missing. Make sure vitest global-setup ran.");
    }

    pool = new pg.Pool({ connectionString: pgUrl, max: 2 });
    rawRedis = createRedisClient(redisUrl);
    redis = createPrefixedRedisProxy(rawRedis, redisPrefix);

    // Create unique schema for this test file
    await pool.query(`CREATE SCHEMA "${schemaName}";`);

    // Run migrations inside the schema manually by executing the SQL files directly
    const migrationClient = new pg.Client({
      connectionString: pgUrl,
    });
    await migrationClient.connect();
    await migrationClient.query(`SET search_path TO "${schemaName}";`);
    
    const migrationsDir = path.join(__dirname, "../../src/db/migrations");
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      for (const file of files) {
        const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        await migrationClient.query(sqlContent);
      }
    }
    
    await migrationClient.end();
  });

  afterAll(async () => {
    // Drop the schema and close PG pool
    if (pool) {
      await pool.query(`DROP SCHEMA "${schemaName}" CASCADE;`);
      await pool.end();
    }

    // Clean up Redis keys with this file's prefix
    if (rawRedis) {
      const keys = await rawRedis.keys(`${redisPrefix}*`);
      if (keys.length > 0) {
        await rawRedis.del(...keys);
      }
      await rawRedis.quit();
    }
  });

  beforeEach(async () => {
    // Acquire dedicated client for the test case
    testClient = await pool.connect();
    // Scope connections to the file-specific schema
    await testClient.query(`SET search_path TO "${schemaName}";`);

    const baseDb = createDb(testClient);
    
    txPromise = new Promise<void>((resolve) => {
      resolveTx = resolve;
    });

    let txClient: any;
    const txStartedPromise = new Promise<void>((resolveStarted) => {
      transactionPromise = baseDb.transaction(async (tx) => {
        txClient = tx;
        resolveStarted();
        await txPromise;
        // Throw a specific error to rollback the transaction
        throw new Error("Force Rollback");
      });
    });

    // Wait for the Drizzle transaction to be initialized and set the txClient
    await txStartedPromise;

    db = txClient;
    testTime = new Date();

    app = createApp({
      db,
      redis,
      clock: () => testTime,
      jwtSecret: process.env.JWT_SECRET || "test-jwt-secret-key-at-least-32-chars-long",
    });
  });

  afterEach(async () => {
    // End the Drizzle transaction by resolving the promise, triggering the forced rollback
    if (resolveTx) {
      resolveTx();
      resolveTx = undefined;
    }
    
    // Wait for the transaction promise to fully complete/rollback
    if (transactionPromise) {
      await transactionPromise.catch(() => {
        // Silently catch the forced rollback error
      });
      transactionPromise = undefined;
    }

    if (testClient) {
      testClient.release();
    }
  });

  /**
   * Helper to perform HTTP requests on Hono in-process.
   */
  const request = async (
    method: string,
    path: string,
    options?: {
      body?: any;
      headers?: Record<string, string>;
    },
  ) => {
    const headers = new Headers(options?.headers || {});
    if (options?.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const init: RequestInit = {
      method,
      headers,
    };
    
    if (options?.body) {
      init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    return await app.request(path, init);
  };

  return {
    get db() {
      return db;
    },
    get redis() {
      return redis;
    },
    get app() {
      return app;
    },
    setClock(date: Date) {
      testTime = date;
    },
    request,
    schemaName,
    redisPrefix,
  };
}
