import { describe, it, expect } from "vitest";
import { createTestHarness } from "../helpers/harness.js";
import { pgTable } from "drizzle-orm/pg-core";
import { cuidPrimaryKey, moneyCents, currency, timestamptz, migrationMeta } from "../../src/db/schema.js";
import { eq, sql } from "drizzle-orm";

// Define a test-specific table to verify money and custom helpers
const testHelpersTable = pgTable("test_db_helpers", {
  id: cuidPrimaryKey(),
  priceCents: moneyCents("price_cents").notNull(),
  curr: currency(),
  timestampVal: timestamptz("timestamp_val").notNull(),
});

describe("infra-db Integration Tests", () => {
  const harness = createTestHarness();

  async function ensureTestTable() {
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS "test_db_helpers" (
        "id" varchar(255) PRIMARY KEY NOT NULL,
        "price_cents" integer NOT NULL,
        "currency" varchar(3) DEFAULT 'CNY' NOT NULL,
        "timestamp_val" timestamp with time zone NOT NULL
      );
    `;
    await harness.db.execute(sql.raw(createTableSql));
  }

  it("cuid2 primary key automatically generated and unique", async () => {
    const db = harness.db;

    // Insert without providing 'id'
    const record1 = await db
      .insert(migrationMeta)
      .values({ metaKey: "key_1", metaValue: "val_1" })
      .returning();

    const record2 = await db
      .insert(migrationMeta)
      .values({ metaKey: "key_2", metaValue: "val_2" })
      .returning();

    expect(record1[0].id).toBeDefined();
    expect(record2[0].id).toBeDefined();
    expect(record1[0].id).not.toBe(record2[0].id);
    expect(record1[0].id.length).toBeGreaterThan(10);
  });

  it("timestamptz read/write has no timezone/offset shift", async () => {
    await ensureTestTable();
    const db = harness.db;

    // Use a specific fixed UTC date
    const testDate = new Date("2026-05-28T12:00:00Z");

    const inserted = await db
      .insert(testHelpersTable)
      .values({
        priceCents: 1000,
        timestampVal: testDate,
      })
      .returning();

    expect(inserted[0].timestampVal.toISOString()).toBe(testDate.toISOString());

    const fetched = await db
      .select()
      .from(testHelpersTable)
      .where(eq(testHelpersTable.id, inserted[0].id));

    expect(fetched[0].timestampVal.toISOString()).toBe(testDate.toISOString());
  });

  it("money *_cents integer read/write has no precision loss", async () => {
    await ensureTestTable();
    const db = harness.db;

    // Write a typical cents amount (e.g. 19999 cents = 199.99 CNY)
    const centsValue = 19999;

    const inserted = await db
      .insert(testHelpersTable)
      .values({
        priceCents: centsValue,
        timestampVal: new Date(),
      })
      .returning();

    expect(inserted[0].priceCents).toBe(centsValue);

    const fetched = await db
      .select()
      .from(testHelpersTable)
      .where(eq(testHelpersTable.id, inserted[0].id));

    expect(fetched[0].priceCents).toBe(centsValue);
  });

  it("test-level transaction rollback works: records are not persisted between runs", async () => {
    const db = harness.db;

    // Check count of records in migrationMeta
    const initialList = await db.select().from(migrationMeta);
    
    // Insert a dummy record
    await db.insert(migrationMeta).values({
      metaKey: "rollback_check_key",
      metaValue: "check",
    });

    const listWithRecord = await db.select().from(migrationMeta);
    expect(listWithRecord.length).toBe(initialList.length + 1);
    
    // During the next test block execution, this record will not exist because the
    // harness automatically rolls back the transaction.
  });

  it("verifying isolation from rollback test case", async () => {
    const db = harness.db;
    
    // Ensure the record inserted in the previous test is NOT visible here.
    const list = await db
      .select()
      .from(migrationMeta)
      .where(eq(migrationMeta.metaKey, "rollback_check_key"));
      
    expect(list).toHaveLength(0);
  });
});

