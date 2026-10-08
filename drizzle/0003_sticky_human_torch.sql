CREATE TABLE "clips" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"url" varchar(1024) NOT NULL,
	"platform" text DEFAULT 'other' NOT NULL,
	"note" text,
	"title" varchar(512),
	"author" varchar(255),
	"thumbnail_url" varchar(1024),
	"status" text DEFAULT 'unprocessed' NOT NULL,
	"video_id" integer,
	"idea_id" integer,
	"error" varchar(1024),
	"saved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "source_analysis_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "clips_url_idx" ON "clips" USING btree ("url");--> statement-breakpoint
CREATE INDEX "clips_status_idx" ON "clips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clips_saved_idx" ON "clips" USING btree ("saved_at");