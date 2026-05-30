import { pgTable, varchar, timestamp, date, time, integer, text, check, boolean, primaryKey, doublePrecision, unique } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";

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

/**
 * Storage Upload Intent Table.
 * Track upload intents, status (pending/confirmed), capability, bound entity, and expiry.
 */
export const upload = pgTable("upload", {
  id: cuidPrimaryKey(),
  status: varchar("status", { length: 50 }).default("pending").notNull(), // 'pending' | 'confirmed'
  key: varchar("key", { length: 1024 }).unique().notNull(),              // The unique Qiniu Kodo key
  capability: varchar("capability", { length: 255 }).notNull(),
  entityId: varchar("entity_id", { length: 255 }),                        // Nullable, bound business entity ID
  expiresAt: timestamptz("expires_at").notNull(),                         // Expiry time for cleanup of pending orphans
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * User Identity and Profile Table.
 * Tracks user details including WeChat openid, unique variable-length business UID, and status.
 */
export const user = pgTable("user", {
  id: cuidPrimaryKey(),
  openid: varchar("openid", { length: 255 }).unique().notNull(),
  uid: varchar("uid", { length: 255 }).unique().notNull(), // variable-length varchar
  nickname: varchar("nickname", { length: 255 }),
  avatar: text("avatar"),
  phone: varchar("phone", { length: 50 }),
  city: varchar("city", { length: 255 }),
  status: varchar("status", { length: 50 }).default("active").notNull(), // 'active' | 'frozen'
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * UID Generation Sequence Table.
 * Stores the last allocated sequence ID for each calendar year.
 */
export const uidSequence = pgTable("uid_sequence", {
  year: integer("year").primaryKey(),
  lastSeq: integer("last_seq").default(1).notNull(),
});

/**
 * Admin User Table.
 * Tracks administrator accounts for stores and operations.
 */
export const adminUser = pgTable("admin_user", {
  id: cuidPrimaryKey(),
  phone: varchar("phone", { length: 50 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull(), // 'super_admin' | 'store_owner' | 'store_staff'
  storeId: varchar("store_id", { length: 255 }),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).default("active").notNull(), // 'active' | 'frozen'
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (_table) => ({
  storeIdConstraint: check("store_id_constraint", sql`
    (role = 'super_admin' AND store_id IS NULL) OR
    (role IN ('store_owner', 'store_staff') AND store_id IS NOT NULL)
  `),
}));

/**
 * Service Category Table.
 * Tracks global service categories.
 */
export const serviceCategory = pgTable("service_category", {
  id: cuidPrimaryKey(),
  name: varchar("name", { length: 255 }).unique().notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Store Table.
 * Tracks operations and configurations of physical stores.
 */
export const store = pgTable("store", {
  id: cuidPrimaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  address: varchar("address", { length: 500 }).notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  phone: varchar("phone", { length: 50 }).notNull(),
  photos: text("photos"), // Stringified JSON array of keys
  openAt: time("open_at").notNull(),
  closeAt: time("close_at").notNull(),
  status: varchar("status", { length: 50 }).default("draft").notNull(), // 'draft' | 'online' | 'offline' | 'frozen'
  area: integer("area"),
  seatCount: integer("seat_count"),
  description: text("description"),
  granularityMin: integer("granularity_min").default(30).notNull(),
  maxAdvanceDays: integer("max_advance_days").default(7).notNull(),
  minAdvanceMin: integer("min_advance_min").default(30).notNull(),
  cancelDeadlineMin: integer("cancel_deadline_min").default(60).notNull(),
  noShowThreshold: integer("no_show_threshold").default(3).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Store Category Relation Table.
 * Many-to-many relationship mapping stores to service categories.
 */
export const storeCategory = pgTable("store_category", {
  storeId: varchar("store_id", { length: 255 }).notNull().references(() => store.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id", { length: 255 }).notNull().references(() => serviceCategory.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.storeId, table.categoryId] }),
}));

/**
 * Service Item Table.
 * Tracks service items offered by physical stores.
 */
export const service = pgTable("service", {
  id: cuidPrimaryKey(),
  storeId: varchar("store_id", { length: 255 }).notNull().references(() => store.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id", { length: 255 }).notNull().references(() => serviceCategory.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  priceCents: moneyCents("price_cents").notNull(),
  currency: currency("currency"),
  durationMinutes: integer("duration_minutes").notNull(),
  status: varchar("status", { length: 50 }).default("active").notNull(), // 'active' | 'inactive'
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Tag Table.
 * Tracks global tags partitioned by type (consultant, review).
 */
export const tag = pgTable("tag", {
  id: cuidPrimaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // 'consultant' | 'review'
  sortOrder: integer("sort_order").default(0).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  typeNameUnique: unique("tag_type_name_unique").on(table.type, table.name),
}));

/**
 * Consultant Table.
 * Tracks consultants bound to a specific store and user.
 */
export const consultant = pgTable("consultant", {
  id: cuidPrimaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => user.id, { onDelete: "cascade" }),
  storeId: varchar("store_id", { length: 255 }).notNull().references(() => store.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  avatar: text("avatar"),
  experienceYears: integer("experience_years").notNull(),
  level: varchar("level", { length: 100 }).notNull(),
  rating: doublePrecision("rating").default(0).notNull(),
  status: varchar("status", { length: 50 }).default("active").notNull(), // 'active' | 'inactive' | 'left'
  autoConfirm: boolean("auto_confirm").default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  userStoreUnique: unique("consultant_user_store_unique").on(table.userId, table.storeId),
}));

/**
 * Consultant-Tag Relation Table.
 * Many-to-many relationship mapping consultants to tags.
 */
export const consultantTag = pgTable("consultant_tag", {
  consultantId: varchar("consultant_id", { length: 255 }).notNull().references(() => consultant.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id", { length: 255 }).notNull().references(() => tag.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.consultantId, table.tagId] }),
}));

