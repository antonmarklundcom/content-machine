CREATE TABLE "comment_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comment_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" integer NOT NULL,
	"post_id" integer,
	"platform" text NOT NULL,
	"external_comment_id" varchar(128) NOT NULL,
	"external_media_id" varchar(128),
	"author" varchar(255),
	"comment_text" text NOT NULL,
	"commented_at" timestamp,
	"language" varchar(8),
	"draft" text,
	"status" text DEFAULT 'new' NOT NULL,
	"error" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_gaps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_gaps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"topic" text NOT NULL,
	"angle" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" smallint,
	"status" text DEFAULT 'new' NOT NULL,
	"idea_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "glossary_terms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"term" varchar(255) NOT NULL,
	"language" varchar(8) DEFAULT 'gn' NOT NULL,
	"meaning_es" text,
	"meaning_en" text,
	"say_as" text,
	"part_of_speech" varchar(32),
	"register" text DEFAULT 'everyday' NOT NULL,
	"jopara_ok" boolean DEFAULT false NOT NULL,
	"example" text,
	"example_translation" text,
	"review_status" text DEFAULT 'proposed' NOT NULL,
	"reviewed_by" varchar(255),
	"reviewed_at" timestamp,
	"source" varchar(255),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narrations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "narrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner_kind" text NOT NULL,
	"owner_ref" varchar(255) NOT NULL,
	"scene_ref" varchar(64),
	"language" varchar(8) NOT NULL,
	"voice_profile_id" integer,
	"speaker" varchar(128),
	"input_text" text NOT NULL,
	"spoken_text" text,
	"text_hash" char(64) NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"master_asset_id" integer,
	"playback_asset_id" integer,
	"duration_ms" integer,
	"alignment" jsonb,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"review_status" text DEFAULT 'unreviewed' NOT NULL,
	"review_note" text,
	"reviewed_by" varchar(255),
	"error" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pronunciations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pronunciations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"term" varchar(255) NOT NULL,
	"say_as" text NOT NULL,
	"language" varchar(8) DEFAULT '*' NOT NULL,
	"scope" varchar(128) DEFAULT 'global' NOT NULL,
	"review_status" text DEFAULT 'proposed' NOT NULL,
	"reviewed_by" varchar(255),
	"reviewed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"series" varchar(255),
	"age_band" varchar(64),
	"source_path" varchar(1024) NOT NULL,
	"source_sha" char(64),
	"raw" jsonb,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand_id" text,
	"notes" text,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_scenes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "story_scenes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"story_id" integer NOT NULL,
	"scene_ref" varchar(64) NOT NULL,
	"position" smallint NOT NULL,
	"kind" text DEFAULT 'page' NOT NULL,
	"text" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lines" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"art_path" varchar(1024),
	"art_width" integer,
	"art_height" integer,
	"alt" text,
	"art_brief" text,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_renders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "video_renders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner_kind" text NOT NULL,
	"owner_ref" varchar(255) NOT NULL,
	"language" varchar(8) NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"plan" jsonb,
	"output_asset_id" integer,
	"srt_asset_id" integer,
	"vtt_asset_id" integer,
	"duration_ms" integer,
	"error" varchar(1024),
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "voice_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"provider" text NOT NULL,
	"provider_voice_id" varchar(255),
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role" text DEFAULT 'narrator' NOT NULL,
	"character_key" varchar(128),
	"brand_id" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_status" text DEFAULT 'not_needed' NOT NULL,
	"consent_person" varchar(255),
	"consent_scope" text,
	"consent_doc_path" varchar(1024),
	"consent_signed_at" timestamp,
	"consent_expires_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "lead_base_url" varchar(1024);--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "learn_category" varchar(64);--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "how_to_start" jsonb;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "implemented_at" timestamp;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "committed_at" timestamp;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "lead_url" varchar(1024);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "publish_options" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_drafts_platform_comment_idx" ON "comment_drafts" USING btree ("platform","external_comment_id");--> statement-breakpoint
CREATE INDEX "comment_drafts_account_status_idx" ON "comment_drafts" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "content_gaps_brand_status_idx" ON "content_gaps" USING btree ("brand_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_terms_term_language_idx" ON "glossary_terms" USING btree ("term","language");--> statement-breakpoint
CREATE INDEX "glossary_terms_review_idx" ON "glossary_terms" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "narrations_owner_idx" ON "narrations" USING btree ("owner_kind","owner_ref","scene_ref","language");--> statement-breakpoint
CREATE INDEX "narrations_voice_idx" ON "narrations" USING btree ("voice_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pronunciations_term_language_scope_idx" ON "pronunciations" USING btree ("term","language","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "stories_slug_idx" ON "stories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "story_scenes_story_scene_idx" ON "story_scenes" USING btree ("story_id","scene_ref");--> statement-breakpoint
CREATE INDEX "video_renders_owner_idx" ON "video_renders" USING btree ("owner_kind","owner_ref","language");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_profiles_key_idx" ON "voice_profiles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "voice_profiles_character_idx" ON "voice_profiles" USING btree ("character_key");