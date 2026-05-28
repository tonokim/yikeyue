import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const REDACT_PATHS = [
  "req.headers.authorization",
  // Phone numbers at any depth (1-5)
  "*.phone", "*.*.phone", "*.*.*.phone", "*.*.*.*.phone", "*.*.*.*.*.phone",
  // OpenID at any depth (1-5)
  "*.openid", "*.*.openid", "*.*.*.openid", "*.*.*.*.openid", "*.*.*.*.*.openid",
  // Access tokens at any depth (1-5)
  "*.access_token", "*.*.access_token", "*.*.*.access_token", "*.*.*.*.access_token", "*.*.*.*.*.access_token",
  // Password at any depth (1-5)
  "*.password", "*.*.password", "*.*.*.password", "*.*.*.*.password", "*.*.*.*.*.password",
  // ID card number at any depth (1-5)
  "*.id_card_no", "*.*.id_card_no", "*.*.*.id_card_no", "*.*.*.*.id_card_no", "*.*.*.*.*.id_card_no",
];

/**
 * Configure Pino Logger.
 * Design invariant: 按 NODE_ENV 切换 JSON / pino-pretty 输出 (5.1)
 * Configures redact paths for sensitive information (5.2)
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  // Use pino-pretty in development/test, JSON in production
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
});

/**
 * Factory to create child logger bound with request_id.
 * Design invariant: 5.3 - Child logger for ctx.log, request_id sharing.
 */
export function createChildLogger(requestId: string): pino.Logger {
  return logger.child({ request_id: requestId });
}
