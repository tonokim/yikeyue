CREATE TABLE IF NOT EXISTS "consultant_service" (
	"consultant_id" varchar(255) NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultant_service_consultant_id_service_id_pk" PRIMARY KEY("consultant_id","service_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consultant_service" ADD CONSTRAINT "consultant_service_consultant_id_consultant_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "consultant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consultant_service" ADD CONSTRAINT "consultant_service_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_consultant_service_service_id" ON "consultant_service" ("service_id");