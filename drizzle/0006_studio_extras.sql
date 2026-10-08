CREATE TABLE "audience_questions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audience_questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"question" text NOT NULL,
	"ask_count" integer DEFAULT 1 NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"video_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "competitor_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"period_days" integer NOT NULL,
	"body" jsonb NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"topic" text NOT NULL,
	"claim" text NOT NULL,
	"source_url" varchar(1024),
	"last_checked_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_derivatives" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "script_derivatives_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"script_id" integer NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "youtube_url" varchar(512);--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "publish_pack" jsonb;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "thumbnail_file" varchar(512);--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "parent_script_id" integer;--> statement-breakpoint
CREATE INDEX "audience_questions_brand_idx" ON "audience_questions" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "competitor_reports_brand_idx" ON "competitor_reports" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "facts_brand_topic_idx" ON "facts" USING btree ("brand_id","topic");--> statement-breakpoint
CREATE INDEX "script_derivatives_script_idx" ON "script_derivatives" USING btree ("script_id");