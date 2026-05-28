import { ErrorCode } from "@yikey/shared";

/**
 * Custom Business Error class.
 * Design Invariant: 7.3 - Represents expected application error states.
 * Maps to standard HTTP status codes and unified error JSON formats.
 */
export class BizError extends Error {
  public readonly code: ErrorCode | string;
  public readonly httpStatus: number;
  public readonly details?: Record<string, any>;

  constructor(
    code: ErrorCode | string,
    message: string,
    options?: { httpStatus?: number; details?: Record<string, any> }
  ) {
    super(message);
    this.name = "BizError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 400;
    this.details = options?.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Format and serialize a BizError into the unified JSON error payload.
 */
export function serializeBizError(err: BizError, requestId: string) {
  return {
    request_id: requestId,
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
    },
  };
}

