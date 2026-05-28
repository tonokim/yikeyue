import { z } from "zod";
import { createMiddleware } from "hono/factory";
import { BizError } from "../errors.js";
import { ERROR_CODES } from "@yikey/shared";
import { AppEnv } from "../types.js";

/**
 * Validate JSON request body against a Zod schema.
 * Design Invariant: 7.5 - Throws 400 validation.invalid_input with error details on failure.
 * The schema performs snake_case -> camelCase transform.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      throw new BizError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Request body must be a valid JSON object", {
        httpStatus: 400,
      });
    }

    const result = await schema.safeParseAsync(body);
    if (!result.success) {
      throw new BizError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Input validation failed", {
        httpStatus: 400,
        details: result.error.format() as any,
      });
    }

    c.set("validBody" as any, result.data);
    await next();
  });
}

/**
 * Validate query params against a Zod schema.
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const query = c.req.query();
    const result = await schema.safeParseAsync(query);
    if (!result.success) {
      throw new BizError(ERROR_CODES.VALIDATION_INVALID_INPUT, "Query parameter validation failed", {
        httpStatus: 400,
        details: result.error.format() as any,
      });
    }

    c.set("validQuery" as any, result.data);
    await next();
  });
}

/**
 * Helper to fetch validated and transformed request body.
 */
export function getValidBody<T>(c: any): T {
  return c.get("validBody") as T;
}

/**
 * Helper to fetch validated and transformed query parameters.
 */
export function getValidQuery<T>(c: any): T {
  return c.get("validQuery") as T;
}

/**
 * Validate and serialize the response data against a Zod schema.
 * Transforms camelCase internal structures to snake_case boundary structures.
 * Throws a 500 BizError representing response serialization error on validation failure.
 */
export function serializeResponse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BizError(
      "system.response_serialization_failed",
      "Response serialization failed",
      {
        httpStatus: 500,
        details: result.error.format() as any,
      }
    );
  }
  return result.data;
}

