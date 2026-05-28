export const ERROR_CODES = {
  // Auth
  AUTH_UNAUTHORIZED: "auth.unauthorized",
  AUTH_FORBIDDEN: "auth.forbidden",

  // Membership
  MEMBERSHIP_REQUIRED: "membership.required",

  // Order
  ORDER_SLOT_TAKEN: "order.slot_taken",
  ORDER_NO_SHOW_BLOCKED: "order.no_show_blocked",
  ORDER_CANCEL_TOO_LATE: "order.cancel_too_late",
  ORDER_INVALID_TRANSITION: "order.invalid_transition",

  // Validation & Limits
  VALIDATION_INVALID_INPUT: "validation.invalid_input",
  RATE_LIMIT_EXCEEDED: "rate_limit.exceeded",
  IDEMPOTENCY_REPLAY: "idempotency.replay",

  // Queue
  QUEUE_JOB_FAILED: "queue.job_failed",
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
