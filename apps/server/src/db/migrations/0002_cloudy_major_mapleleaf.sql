CREATE TABLE IF NOT EXISTS "uid_sequence" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_seq" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"openid" varchar(255) NOT NULL,
	"uid" varchar(255) NOT NULL,
	"nickname" varchar(255),
	"avatar" text,
	"phone" varchar(50),
	"city" varchar(255),
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_openid_unique" UNIQUE("openid"),
	CONSTRAINT "user_uid_unique" UNIQUE("uid")
);
