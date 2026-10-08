CREATE TABLE "account_metrics" (
	"account_id" integer NOT NULL,
	"date" date NOT NULL,
	"followers" integer,
	"reach" integer,
	"profile_visits" integer,
	"raw" jsonb,
	CONSTRAINT "account_metrics_account_id_date_pk" PRIMARY KEY("account_id","date")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text,
	"account_id" integer,
	"kind" text NOT NULL,
	"mime" varchar(128) NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"width" integer,
	"height" integer,
	"duration_sec" real,
	"local_path" varchar(1024),
	"public_url" varchar(1024),
	"public_expires_at" timestamp,
	"drive_file_id" varchar(255),
	"thumb_path" varchar(1024),
	"source" text NOT NULL,
	"source_ref" varchar(1024),
	"prompt" text,
	"model" varchar(128),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"alt_text" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_families" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fonts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo_asset_id" integer,
	"higgsfield" jsonb DEFAULT '{"elementIds":[],"characterIds":[],"styleNotes":""}'::jsonb NOT NULL,
	"ctas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dos" text,
	"donts" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_posts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "competitor_posts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"competitor_id" integer NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"permalink" varchar(1024),
	"caption" text,
	"media_type" varchar(32),
	"posted_at" timestamp,
	"likes" integer,
	"comments" integer,
	"views" integer,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "integrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"label" varchar(255) NOT NULL,
	"account_ref" varchar(255),
	"token_ciphertext" text,
	"token_expires_at" timestamp,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_assets" (
	"post_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"role" text DEFAULT 'slide' NOT NULL,
	CONSTRAINT "post_assets_post_id_position_pk" PRIMARY KEY("post_id","position")
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "post_metrics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"post_id" integer NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"reach" integer,
	"impressions" integer,
	"plays" integer,
	"likes" integer,
	"comments" integer,
	"saves" integer,
	"shares" integer,
	"follows" integer,
	"profile_visits" integer,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "posts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" integer NOT NULL,
	"brand_id" text NOT NULL,
	"idea_id" integer,
	"parent_post_id" integer,
	"format" text NOT NULL,
	"status" text DEFAULT 'idea' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" jsonb,
	"caption" text,
	"first_comment" text,
	"notes" text,
	"scheduled_for" timestamp,
	"published_at" timestamp,
	"permalink" varchar(1024),
	"external_media_id" varchar(128),
	"external_container_id" varchar(128),
	"publish_error" varchar(1024),
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"last_publish_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "social_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"platform" text NOT NULL,
	"handle" varchar(255) NOT NULL,
	"language" varchar(8),
	"status" text DEFAULT 'planned' NOT NULL,
	"is_professional" boolean DEFAULT false NOT NULL,
	"external_id" varchar(128),
	"integration_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_competitors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "social_competitors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"platform" text NOT NULL,
	"handle" varchar(255) NOT NULL,
	"role" text DEFAULT 'competitor' NOT NULL,
	"external_id" varchar(128),
	"followers" integer,
	"last_synced_at" timestamp,
	"last_error" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facts" ALTER COLUMN "brand_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "family_id" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "brand_id" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "purpose" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "post_text" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "claims" jsonb;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "media_asset_id" integer;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "telegram_file_id" varchar(255);--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "fetched_at" timestamp;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "family_id" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "external_key" varchar(255);--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "language" varchar(8) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "family_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_sha256_idx" ON "assets" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "assets_brand_status_idx" ON "assets" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "assets_created_idx" ON "assets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assets_account_idx" ON "assets" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_posts_external_id_idx" ON "competitor_posts" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "competitor_posts_competitor_posted_idx" ON "competitor_posts" USING btree ("competitor_id","posted_at");--> statement-breakpoint
CREATE INDEX "integrations_provider_idx" ON "integrations" USING btree ("provider","status");--> statement-breakpoint
CREATE INDEX "post_assets_asset_idx" ON "post_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "post_metrics_post_captured_idx" ON "post_metrics" USING btree ("post_id","captured_at");--> statement-breakpoint
CREATE INDEX "posts_account_status_idx" ON "posts" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "posts_scheduled_idx" ON "posts" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "posts_brand_status_idx" ON "posts" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "posts_parent_idx" ON "posts" USING btree ("parent_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_platform_handle_idx" ON "social_accounts" USING btree ("platform","handle");--> statement-breakpoint
CREATE INDEX "social_accounts_brand_idx" ON "social_accounts" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_competitors_brand_platform_handle_idx" ON "social_competitors" USING btree ("brand_id","platform","handle");--> statement-breakpoint
CREATE INDEX "clips_brand_idx" ON "clips" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "clips_purpose_idx" ON "clips" USING btree ("purpose");--> statement-breakpoint
CREATE INDEX "facts_family_topic_idx" ON "facts" USING btree ("family_id","topic");--> statement-breakpoint
CREATE UNIQUE INDEX "facts_family_key_language_idx" ON "facts" USING btree ("family_id","external_key","language") WHERE "facts"."external_key" is not null;--> statement-breakpoint
CREATE INDEX "lessons_family_kind_idx" ON "lessons" USING btree ("family_id","kind");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Data migration (PLAN.md §1.52, §5.O9.1). Hand-written below the generated
-- DDL; every statement is a no-op on an empty database.
--
-- 1. Existing facts were checked by hand (they carry last_checked_at), so they
--    stay citable as-is: verified, in their brand's language (§1.48).
-- ---------------------------------------------------------------------------
UPDATE "facts" SET "verified" = true;--> statement-breakpoint
UPDATE "facts" SET "language" = left("brands"."language", 8) FROM "brands" WHERE "brands"."id" = "facts"."brand_id";--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. Brand `residency-guide` becomes `guide`, with every brand_id pointing at
--    it. If a `guide` row somehow exists already, it wins and the old row goes.
--    brand_sources' key includes brand_id, so a link both rows share is
--    dropped from the old side first.
-- ---------------------------------------------------------------------------
DELETE FROM "brand_sources" AS old USING "brand_sources" AS cur WHERE old."brand_id" = 'residency-guide' AND cur."brand_id" = 'guide' AND cur."source_id" = old."source_id";--> statement-breakpoint
UPDATE "brands" SET "id" = 'guide' WHERE "id" = 'residency-guide' AND NOT EXISTS (SELECT 1 FROM "brands" WHERE "id" = 'guide');--> statement-breakpoint
DELETE FROM "brands" WHERE "id" = 'residency-guide';--> statement-breakpoint
UPDATE "ideas" SET "brand_id" = 'guide' WHERE "brand_id" = 'residency-guide';--> statement-breakpoint
UPDATE "lessons" SET "brand_id" = 'guide' WHERE "brand_id" = 'residency-guide';--> statement-breakpoint
UPDATE "scripts" SET "brand_id" = 'guide' WHERE "brand_id" = 'residency-guide';--> statement-breakpoint
UPDATE "brand_sources" SET "brand_id" = 'guide' WHERE "brand_id" = 'residency-guide';--> statement-breakpoint
UPDATE "competitor_reports" SET "brand_id" = 'guide' WHERE "brand_id" = 'residency-guide';--> statement-breakpoint
UPDATE "audience_questions" SET "brand_id" = 'guide' WHERE "brand_id" = 'residency-guide';--> statement-breakpoint
UPDATE "facts" SET "brand_id" = 'guide' WHERE "brand_id" = 'residency-guide';--> statement-breakpoint
UPDATE "clips" SET "brand_id" = 'guide' WHERE "brand_id" = 'residency-guide';--> statement-breakpoint
UPDATE "research_notes" SET "related_brand_ids" = (SELECT json_agg(CASE WHEN x = 'residency-guide' THEN 'guide' ELSE x END) FROM json_array_elements_text("research_notes"."related_brand_ids") AS x) WHERE "related_brand_ids"::jsonb ? 'residency-guide';--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. The renamed brand joins its family. Only on a database that had it: a
--    fresh one gets the family from `npm run db:seed`.
-- ---------------------------------------------------------------------------
INSERT INTO "brand_families" ("id", "name") SELECT 'paraguay-residency', 'Paraguay residency' WHERE EXISTS (SELECT 1 FROM "brands" WHERE "id" = 'guide') ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "brands" SET "family_id" = 'paraguay-residency' WHERE "id" = 'guide' AND "family_id" IS NULL;
