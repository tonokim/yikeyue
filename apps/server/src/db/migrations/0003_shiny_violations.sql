CREATE TABLE IF NOT EXISTS "admin_user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"phone" varchar(50) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(50) NOT NULL,
	"store_id" varchar(255),
	"name" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_phone_unique" UNIQUE("phone"),
	CONSTRAINT "admin_user_store_id_constraint" CHECK (
		(role = 'super_admin' AND store_id IS NULL) OR
		(role IN ('store_owner', 'store_staff') AND store_id IS NOT NULL)
	)
);
