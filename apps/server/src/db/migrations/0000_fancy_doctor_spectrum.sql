CREATE TABLE IF NOT EXISTS "migration_meta" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"meta_key" text NOT NULL,
	"meta_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_meta_meta_key_unique" UNIQUE("meta_key")
);
