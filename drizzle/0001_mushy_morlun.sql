CREATE TABLE "analyses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analyses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"video_id" integer NOT NULL,
	"model" varchar(64) NOT NULL,
	"prompt_version" smallint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"summary" text,
	"takeaways" json,
	"hook_breakdown" json,
	"timeline" json,
	"gaps" json,
	"ideas" json,
	"topics" json,
	"entities" json,
	"content_type" varchar(64),
	"raw_response" text,
	"error" varchar(1024),
	"batch_id" varchar(128),
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider_batch_id" varchar(128) NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"model" varchar(64) NOT NULL,
	"video_count" integer DEFAULT 0 NOT NULL,
	"estimated_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"collected_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"slug" varchar(128) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outlines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"analysis_id" integer NOT NULL,
	"idea_index" smallint NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error" varchar(1024),
	"content" json,
	"raw_response" text,
	"model" varchar(64),
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screenings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "screenings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"video_id" integer NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"score" smallint,
	"reason" varchar(512),
	"model" varchar(64) NOT NULL,
	"prompt_version" smallint DEFAULT 1 NOT NULL,
	"error" varchar(1024),
	"raw_response" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"youtube_id" varchar(64) NOT NULL,
	"title" varchar(512) NOT NULL,
	"url" varchar(512) NOT NULL,
	"last_polled_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spend_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"day" date NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"slug" varchar(128) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transcripts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"video_id" integer NOT NULL,
	"language" varchar(16),
	"source" text DEFAULT 'captions' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yt_users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "yt_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" varchar(255) NOT NULL,
	"role" text DEFAULT 'employee' NOT NULL,
	"password_hash" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "yt_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "video_entities" (
	"video_id" integer NOT NULL,
	"entity_id" integer NOT NULL,
	CONSTRAINT "video_entities_video_id_entity_id_pk" PRIMARY KEY("video_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "video_reads" (
	"video_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp,
	"pinned" boolean DEFAULT false NOT NULL,
	CONSTRAINT "video_reads_video_id_user_id_pk" PRIMARY KEY("video_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "video_topics" (
	"video_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	CONSTRAINT "video_topics_video_id_topic_id_pk" PRIMARY KEY("video_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "video_unit_marks" (
	"video_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"unit_type" text NOT NULL,
	"unit_index" integer NOT NULL,
	"unit_text" varchar(1024) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "video_unit_marks_video_id_user_id_unit_type_unit_index_pk" PRIMARY KEY("video_id","user_id","unit_type","unit_index")
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "videos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"youtube_id" varchar(16) NOT NULL,
	"source_id" integer,
	"title" varchar(512) NOT NULL,
	"description" text,
	"channel_title" varchar(255),
	"published_at" timestamp,
	"duration_seconds" integer,
	"view_count" bigint,
	"like_count" bigint,
	"comment_count" bigint,
	"thumbnail_url" varchar(512),
	"caption_status" text DEFAULT 'unknown' NOT NULL,
	"caption_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analyses_video_idx" ON "analyses" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "analyses_status_idx" ON "analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analyses_batch_idx" ON "analyses" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_provider_id_idx" ON "batches" USING btree ("provider_batch_id");--> statement-breakpoint
CREATE INDEX "batches_status_idx" ON "batches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_slug_idx" ON "entities" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "outlines_analysis_idea_idx" ON "outlines" USING btree ("analysis_id","idea_index");--> statement-breakpoint
CREATE UNIQUE INDEX "screenings_video_id_idx" ON "screenings" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "screenings_score_idx" ON "screenings" USING btree ("score");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_youtube_id_idx" ON "sources" USING btree ("youtube_id");--> statement-breakpoint
CREATE INDEX "sources_active_polled_idx" ON "sources" USING btree ("active","last_polled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_log_day_idx" ON "spend_log" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_slug_idx" ON "topics" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_video_id_idx" ON "transcripts" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "video_entities_entity_idx" ON "video_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "video_reads_user_read_idx" ON "video_reads" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "video_reads_user_pinned_idx" ON "video_reads" USING btree ("user_id","pinned");--> statement-breakpoint
CREATE INDEX "video_topics_topic_idx" ON "video_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "video_unit_marks_user_created_idx" ON "video_unit_marks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_youtube_id_idx" ON "videos" USING btree ("youtube_id");--> statement-breakpoint
CREATE INDEX "videos_source_idx" ON "videos" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "videos_published_idx" ON "videos" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "videos_caption_status_idx" ON "videos" USING btree ("caption_status");--> statement-breakpoint
CREATE INDEX "videos_created_idx" ON "videos" USING btree ("created_at");