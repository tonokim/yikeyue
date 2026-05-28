import { ErrorHandler } from "hono";
import { AppEnv } from "../types.js";
import { BizError, serializeBizError } from "../errors.js";
import { logger as rootLogger } from "../logger/index.js";

/**
 * Global Error Handler for Hono (app.onError).
 * Design Invariant: 7.3 - BizError maps to its own code and status.
 * All other errors map to 500 without leaking stack traces.
 * Output follows the unified failure response shape.
 */
export const errorHandler: ErrorHandler<AppEnv> = async (err, c) => {
  const reqId = c.var.requestId || "unknown";
  const log = c.var.log || rootLogger;

  if (err instanceof BizError) {
    log.warn(
      {
        code: err.code,
        message: err.message,
        status: err.httpStatus,
        details: err.details,
      },
      `Business Error [${err.code}]: ${err.message}`,
    );

    return c.json(
      serializeBizError(err, reqId),
      err.httpStatus as any,
    );
  }

  // Record unhandled system errors at 'error' level with stack trace
  log.error({ err }, "Unhandled server error encountered");

  return c.json(
    {
      request_id: reqId,
      error: {
        code: "internal.server_error",
        message: "An internal server error occurred.",
      },
    },
    500,
  );
};
