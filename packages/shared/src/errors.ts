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

  // Tag & Consultant
  TAG_NAME_EXISTS: "tag.name_exists",
  TAG_NOT_FOUND: "tag.tag_not_found",
  CONSULTANT_USER_NOT_FOUND: "consultant.user_not_found",
  CONSULTANT_ALREADY_BOUND: "consultant.already_bound",
  CONSULTANT_INVALID_TAG: "consultant.invalid_tag",
  CONSULTANT_NOT_FOUND: "consultant.consultant_not_found",

  // Store & Service & Router
  STORE_NOT_FOUND: "store.store_not_found",
  STORE_CATEGORY_NAME_EXISTS: "store.category_name_exists",
  STORE_CATEGORY_NOT_FOUND: "store.category_not_found",
  STORE_INVALID_CATEGORY: "store.invalid_category",
  SERVICE_INVALID_CATEGORY: "service.invalid_category",
  SERVICE_CATEGORY_NOT_IN_STORE: "service.category_not_in_store",
  SERVICE_NOT_FOUND: "service.service_not_found",
  ROUTER_NOT_FOUND: "router.not_found",
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
