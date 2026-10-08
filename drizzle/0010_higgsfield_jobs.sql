CREATE TABLE "higgsfield_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "higgsfield_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"target_ref" varchar(255),
	"brand_id" text,
	"prompt" text NOT NULL,
	"max_credits" real NOT NULL,
	"credits_used" real,
	"status" text DEFAULT 'queued' NOT NULL,
	"external_job_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"log" text,
	"error" varchar(1024),
	"pid" integer,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "higgsfield_jobs_status_idx" ON "higgsfield_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "higgsfield_jobs_target_idx" ON "higgsfield_jobs" USING btree ("target_ref");