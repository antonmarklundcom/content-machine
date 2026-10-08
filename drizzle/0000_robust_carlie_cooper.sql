CREATE TABLE IF NOT EXISTS "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"niche" text NOT NULL,
	"market" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"voice" text,
	"platforms" json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ideas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ideas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"title" text NOT NULL,
	"angle" text NOT NULL,
	"format" text NOT NULL,
	"platform" text NOT NULL,
	"draft_copy" text NOT NULL,
	"visual_notes" text,
	"research_note_id" integer,
	"citations" json,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"topic" text NOT NULL,
	"summary" text NOT NULL,
	"market" text NOT NULL,
	"related_brand_ids" json NOT NULL,
	"sources" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
