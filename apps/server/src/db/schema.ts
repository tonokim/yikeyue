import { pgTable, varchar, timestamp, date, time, integer, text } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

/**
 * Primary key column helper using cuid2.
 * Design invariant: All table primary keys are cuid2 strings named 'id'.
 */
export const cuidPrimaryKey = (name: string = "id") => {
  return varchar(name, { length: 255 })
    .primaryKey()
    .$defaultFn(() => createId());
};

/**
 * Foreign key column helper referencing a cuid2 string.
 */
export const cuidForeignKey = (name: string) => {
  return varchar(name, { length: 255 });
};

/**
 * UTC Timestamp column helper (timestamptz in Postgres).
 * Design invariant: All timestamps are stored in UTC with timezone.
 */
export const timestamptz = (name: string) => {
  return timestamp(name, { withTimezone: true, mode: "date" });
};

export const createdAt = () => timestamptz("created_at").defaultNow().notNull();
export const updatedAt = () => timestamptz("updated_at").defaultNow().notNull();

/**
 * Local date helper (date type in Postgres, e.g. '2026-05-28').
 * Understood in Asia/Shanghai timezone.
 */
export const localDate = (name: string) => {
  if (!name.endsWith("_local")) {
    throw new Error(`Local date column name "${name}" must end with "_local"`);
  }
  return date(name, { mode: "string" });
};

/**
 * Daily time slots/hours helper (time type in Postgres, e.g. '09:00:00').
 * Precision 0, understood in Asia/Shanghai.
 */
export const localTime = (name: string) => {
  return time(name, { precision: 0 });
};

/**
 * Money cents helper (integer type in Postgres).
 * Design invariant: Amounts must be integers representing cents, named with '*_cents' suffix.
 */
export const moneyCents = (name: string) => {
  if (!name.endsWith("_cents")) {
    throw new Error(`Money cents column name "${name}" must end with "_cents"`);
  }
  return integer(name);
};

/**
 * Currency field, defaulting to 'CNY'.
 */
export const currency = (name: string = "currency") => {
  return varchar(name, { length: 3 }).default("CNY").notNull();
};

/**
 * Initial metadata table to bootstrap migration and test helpers.
 * Design D10 - Minimal schema migrations meta information, no business tables yet.
 */
export const migrationMeta = pgTable("migration_meta", {
  id: cuidPrimaryKey(),
  metaKey: text("meta_key").unique().notNull(),
  metaValue: text("meta_value"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
