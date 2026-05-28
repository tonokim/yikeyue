import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createTestHarness } from "../helpers/harness.js";
import { validateBody, validateQuery, getValidBody, getValidQuery, serializeResponse } from "../../src/middleware/zod-validator.js";

// Request validator schema: snake_case input -> camelCase output (7.5)
const testUserRequestSchema = z
  .object({
    first_name: z.string().min(2),
    phone_number: z.string(),
  })
  .transform((val) => ({
    firstName: val.first_name,
    phoneNumber: val.phone_number,
  }));

// Response serializer schema: camelCase input -> snake_case output (7.5)
const testUserResponseSchema = z
  .object({
    firstName: z.string(),
    phoneNumber: z.string(),
    memberStatus: z.string(),
  })
  .transform((val) => ({
    first_name: val.firstName,
    phone_number: val.phoneNumber,
    member_status: val.memberStatus,
  }));

describe("Zod validation & transform integration tests", () => {
  const harness = createTestHarness();

  it("fails validation: invalid JSON input returns 400 validation.invalid_input", async () => {
    harness.app.post(
      "/test-zod/body",
      validateBody(testUserRequestSchema),
      (c: any) => {
        return c.json({ ok: true });
      },
    );

    // Send malformed JSON body
    const res = await harness.request("POST", "/test-zod/body", {
      body: "{ malformed-json }",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("validation.invalid_input");
    expect(body.error.message).toContain("JSON");
  });

  it("fails validation: missing/invalid fields return 400 validation.invalid_input", async () => {
    harness.app.post(
      "/test-zod/body",
      validateBody(testUserRequestSchema),
      (c: any) => {
        return c.json({ ok: true });
      },
    );

    // Send missing required first_name field
    const res = await harness.request("POST", "/test-zod/body", {
      body: { phone_number: "13800138000" },
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe("validation.invalid_input");
    expect(body.error.details).toBeDefined();
    expect(body.error.details.first_name).toBeDefined(); // detail error path
  });

  it("successful validation: performs snake_case -> camelCase request transform", async () => {
    harness.app.post(
      "/test-zod/body",
      validateBody(testUserRequestSchema),
      (c: any) => {
        const data = getValidBody<z.output<typeof testUserRequestSchema>>(c);
        // Expect variables inside handler to be camelCase
        return c.json({
          received: data,
        });
      },
    );

    const res = await harness.request("POST", "/test-zod/body", {
      body: {
        first_name: "Alice",
        phone_number: "13800138000",
      },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    // Inner c.json output will get wrapped.
    // body.data is the returned value { received: ... }
    expect(body.data.received).toEqual({
      firstName: "Alice",
      phoneNumber: "13800138000",
    });
  });

  it("query validation: parses and transforms query parameters", async () => {
    // Schema: query snake_case -> camelCase
    const testQuerySchema = z
      .object({
        search_query: z.string(),
        limit_val: z.coerce.number().default(10),
      })
      .transform((val) => ({
        searchQuery: val.search_query,
        limitVal: val.limit_val,
      }));

    harness.app.get(
      "/test-zod/query",
      validateQuery(testQuerySchema),
      (c: any) => {
        const queryData = getValidQuery<z.output<typeof testQuerySchema>>(c);
        return c.json(queryData);
      },
    );

    const res = await harness.request("GET", "/test-zod/query?search_query=test&limit_val=25");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual({
      searchQuery: "test",
      limitVal: 25,
    });
  });

  it("response boundary: hand-written serializer transforms camelCase -> snake_case output", async () => {
    harness.app.get("/test-zod/response", (c: any) => {
      // internal representation is camelCase
      const internalData = {
        firstName: "Bob",
        phoneNumber: "13900139000",
        memberStatus: "active",
      };
      
      // Explicitly serialize at the boundary
      const serialized = testUserResponseSchema.parse(internalData);
      return c.json(serialized);
    });

    const res = await harness.request("GET", "/test-zod/response");
    expect(res.status).toBe(200);

    const body = await res.json();
    // Expect output to be in snake_case format
    expect(body.data).toEqual({
      first_name: "Bob",
      phone_number: "13900139000",
      member_status: "active",
    });
  });

  it("serializeResponse helper: succeeds and maps camelCase internal structure to snake_case boundary", async () => {
    harness.app.get("/test-zod/serialize-success", (c: any) => {
      const internalData = {
        firstName: "Charlie",
        phoneNumber: "13700137000",
        memberStatus: "vip",
      };
      const responseBody = serializeResponse(testUserResponseSchema, internalData);
      return c.json(responseBody);
    });

    const res = await harness.request("GET", "/test-zod/serialize-success");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      first_name: "Charlie",
      phone_number: "13700137000",
      member_status: "vip",
    });
  });

  it("serializeResponse helper: fails and throws 500 error when data is invalid", async () => {
    harness.app.get("/test-zod/serialize-fail", (c: any) => {
      const invalidData = {
        firstName: "Dave",
        // missing phoneNumber and memberStatus
      };
      const responseBody = serializeResponse(testUserResponseSchema, invalidData);
      return c.json(responseBody);
    });

    const res = await harness.request("GET", "/test-zod/serialize-fail");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("system.response_serialization_failed");
    expect(body.error.message).toBe("Response serialization failed");
    expect(body.error.details).toBeDefined();
  });
});

