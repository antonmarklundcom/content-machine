ALTER TABLE "posts" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_attempt_id" varchar(36);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_state" text DEFAULT 'idle' NOT NULL;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_target" jsonb;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_approved_revision" integer;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_approved_by" integer;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_approved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_upload" jsonb;
--> statement-breakpoint
-- Existing schedules have no durable owner approval. Require explicit review/reapproval.
UPDATE "posts" SET "status" = 'ready', "revision" = "revision" + 1,
 "publish_error" = 'Review and schedule again: publication approval must bind the current content, account and assets.'
 WHERE "status" = 'scheduled';
--> statement-breakpoint
UPDATE "posts" SET "publish_state" = 'confirmed', "status" = CASE WHEN "status" = 'archived' THEN 'archived' ELSE 'published' END
 WHERE "external_media_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "posts" SET "publish_state" = 'ambiguous', "status" = 'failed',
 "publish_error" = 'An earlier publication may exist. Verify the provider before creating a new post.'
 WHERE "external_media_id" IS NULL AND ("external_container_id" IS NOT NULL OR "status" = 'publishing');
--> statement-breakpoint
CREATE TABLE "spend_holds" (
 "id" varchar(36) PRIMARY KEY NOT NULL,
 "owner" text NOT NULL,
 "estimated_usd" numeric(10,6) NOT NULL,
 "status" text DEFAULT 'held' NOT NULL,
 "expires_at" timestamp NOT NULL,
 "accounted_day" date,
 "actual_usd" numeric(10,6),
 "created_at" timestamp DEFAULT now() NOT NULL,
 "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Preserve pre-migration orphaned holds conservatively; reconciliation converts them to visible estimates.
INSERT INTO "spend_holds" ("id", "owner", "estimated_usd", "expires_at")
 SELECT '00000000-0000-0000-0000-000000000001', 'legacy reservation', "reserved_usd", now() - interval '1 second'
 FROM "spend_reservation" WHERE "id" = 1 AND "reserved_usd" > 0;
