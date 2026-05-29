CREATE TABLE IF NOT EXISTS "service_category" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_category_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" varchar(500) NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"phone" varchar(50) NOT NULL,
	"photos" text,
	"open_at" time NOT NULL,
	"close_at" time NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"area" integer,
	"seat_count" integer,
	"description" text,
	"granularity_min" integer DEFAULT 30 NOT NULL,
	"max_advance_days" integer DEFAULT 7 NOT NULL,
	"min_advance_min" integer DEFAULT 30 NOT NULL,
	"cancel_deadline_min" integer DEFAULT 60 NOT NULL,
	"no_show_threshold" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_category" (
	"store_id" varchar(255) NOT NULL,
	"category_id" varchar(255) NOT NULL,
	CONSTRAINT "store_category_store_id_category_id_pk" PRIMARY KEY("store_id","category_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_category" ADD CONSTRAINT "store_category_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_category" ADD CONSTRAINT "store_category_category_id_service_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "service_category"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
