export interface SuccessResponse<T> {
  request_id: string;
  data: T;
}

export interface ErrorDetail {
  [key: string]: any;
}

export interface ErrorResponse {
  request_id: string;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail;
  };
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

import { z } from "zod";

// Zod Schema representing the unified health check response contract
export const HealthResponseSchema = z.object({
  request_id: z.string(),
  data: z.object({
    status: z.string(),
    postgres: z.string(),
    redis: z.string(),
  }),
});

