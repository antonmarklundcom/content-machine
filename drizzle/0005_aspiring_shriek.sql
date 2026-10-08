CREATE TABLE "brand_sources" (
	"brand_id" text NOT NULL,
	"source_id" integer NOT NULL,
	"role" text DEFAULT 'competitor' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brand_sources_brand_id_source_id_pk" PRIMARY KEY("brand_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lessons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"text" text NOT NULL,
	"kind" text DEFAULT 'lesson' NOT NULL,
	"brand_id" text,
	"video_id" integer,
	"timestamp_sec" integer,
	"source_url" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scripts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"idea_id" integer,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"recorded_at" timestamp,
	"posted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "brand_sources_source_idx" ON "brand_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "lessons_brand_kind_idx" ON "lessons" USING btree ("brand_id","kind");--> statement-breakpoint
CREATE INDEX "lessons_video_idx" ON "lessons" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "scripts_brand_status_idx" ON "scripts" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "scripts_updated_idx" ON "scripts" USING btree ("updated_at");