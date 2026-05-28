import pino from "pino";
import pg from "pg";
import { logger } from "../logger/index.js";
import { createDb, DatabaseInstance } from "../db/index.js";

/**
 * JobContext structure containing child logger, current time, and database instance.
 * Design Invariant: D2 - parallel to AppContext but db is not request-transaction by default.
 */
export interface JobContext {
  log: pino.Logger;
  now: Date;
  db: DatabaseInstance;
}

export interface JobContextOptions {
  queueName: string;
  jobId: string;
  attempt: number;
  pgPool: pg.Pool;
  clock?: () => Date;
  db?: DatabaseInstance;
}

export function createJobContext(opts: JobContextOptions): JobContext {
  const log = logger.child({
    queue: opts.queueName,
    job_id: opts.jobId,
    attempt: opts.attempt,
  });

  const clock = opts.clock ?? (() => new Date());
  const db = opts.db ?? createDb(opts.pgPool);

  return {
    log,
    get now() {
      return clock();
    },
    db,
  };
}
