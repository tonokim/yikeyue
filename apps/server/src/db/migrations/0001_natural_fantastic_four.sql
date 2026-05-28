CREATE TABLE IF NOT EXISTS "upload" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"key" varchar(1024) NOT NULL,
	"capability" varchar(255) NOT NULL,
	"entity_id" varchar(255),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_key_unique" UNIQUE("key")
);
