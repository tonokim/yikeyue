import { z } from "zod";

/**
 * Payload schema for the demo `infra:ping` job.
 */
export const infraPingSchema = z.object({
  message: z.string(),
  timestamp: z.coerce.number(),
  sleepMs: z.number().optional(),
});

export type InfraPingPayload = z.infer<typeof infraPingSchema>;

/**
 * Payload schema for the daily repeatable `infra:dead-letter-scan` job.
 */
export const deadLetterScanSchema = z.object({
  scanTime: z.coerce.number(),
});

export type DeadLetterScanPayload = z.infer<typeof deadLetterScanSchema>;
