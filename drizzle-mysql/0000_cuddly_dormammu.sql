CREATE TABLE `account_metrics` (
	`account_id` int NOT NULL,
	`date` date NOT NULL,
	`followers` int,
	`reach` int,
	`profile_visits` int,
	`raw` json,
	CONSTRAINT `account_metrics_account_id_date_pk` PRIMARY KEY(`account_id`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`video_id` int NOT NULL,
	`model` varchar(64) NOT NULL,
	`prompt_version` smallint NOT NULL DEFAULT 1,
	`status` varchar(64) NOT NULL DEFAULT 'ok',
	`summary` longtext,
	`takeaways` json,
	`hook_breakdown` json,
	`timeline` json,
	`gaps` json,
	`ideas` json,
	`topics` json,
	`entities` json,
	`content_type` varchar(64),
	`raw_response` longtext,
	`error` varchar(1024),
	`batch_id` varchar(128),
	`input_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`cache_read_tokens` int NOT NULL DEFAULT 0,
	`cache_write_tokens` int NOT NULL DEFAULT 0,
	`cost_usd` decimal(10,6) NOT NULL DEFAULT '0',
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `analyses_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255),
	`account_id` int,
	`kind` varchar(64) NOT NULL,
	`mime` varchar(128) NOT NULL,
	`bytes` bigint NOT NULL,
	`sha256` char(64) NOT NULL,
	`width` int,
	`height` int,
	`duration_sec` double,
	`local_path` varchar(1024),
	`public_url` varchar(1024),
	`public_expires_at` datetime(3),
	`drive_file_id` varchar(255),
	`thumb_path` varchar(1024),
	`source` varchar(64) NOT NULL,
	`source_ref` varchar(1024),
	`prompt` longtext,
	`model` varchar(128),
	`tags` json NOT NULL DEFAULT (json_array()),
	`status` varchar(64) NOT NULL DEFAULT 'new',
	`alt_text` longtext,
	`notes` longtext,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `assets_sha256_idx` UNIQUE(`sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `audience_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255) NOT NULL,
	`question` longtext NOT NULL,
	`ask_count` int NOT NULL DEFAULT 1,
	`examples` json NOT NULL DEFAULT (json_array()),
	`video_ids` json NOT NULL DEFAULT (json_array()),
	`status` varchar(64) NOT NULL DEFAULT 'new',
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `audience_questions_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider_batch_id` varchar(128) NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'in_progress',
	`model` varchar(64) NOT NULL,
	`video_count` int NOT NULL DEFAULT 0,
	`estimated_usd` decimal(10,6) NOT NULL DEFAULT '0',
	`submitted_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`collected_at` datetime(3),
	CONSTRAINT `batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `batches_provider_id_idx` UNIQUE(`provider_batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `brand_families` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`notes` longtext,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `brand_families_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `brand_kits` (
	`brand_id` varchar(255) NOT NULL,
	`colors` json NOT NULL DEFAULT (json_array()),
	`fonts` json NOT NULL DEFAULT (json_array()),
	`logo_asset_id` int,
	`higgsfield` json NOT NULL DEFAULT ('{"elementIds":[],"characterIds":[],"styleNotes":""}'),
	`ctas` json NOT NULL DEFAULT (json_array()),
	`hashtags` json NOT NULL DEFAULT (json_array()),
	`dos` longtext,
	`donts` longtext,
	`lead_base_url` varchar(1024),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `brand_kits_brand_id` PRIMARY KEY(`brand_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `brand_sources` (
	`brand_id` varchar(255) NOT NULL,
	`source_id` int NOT NULL,
	`role` varchar(64) NOT NULL DEFAULT 'competitor',
	`added_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `brand_sources_brand_id_source_id_pk` PRIMARY KEY(`brand_id`,`source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`domain` longtext NOT NULL,
	`niche` longtext NOT NULL,
	`market` varchar(255) NOT NULL,
	`language` varchar(16) NOT NULL DEFAULT 'es',
	`voice` longtext,
	`platforms` json NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`family_id` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `brands_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `clips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`url` varchar(1024) NOT NULL,
	`url_hash` char(64) GENERATED ALWAYS AS (sha2(url, 256)) STORED,
	`platform` varchar(64) NOT NULL DEFAULT 'other',
	`note` longtext,
	`title` varchar(512),
	`author` varchar(255),
	`thumbnail_url` varchar(1024),
	`status` varchar(64) NOT NULL DEFAULT 'unprocessed',
	`video_id` int,
	`idea_id` int,
	`error` varchar(1024),
	`saved_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`brand_id` varchar(255),
	`purpose` varchar(64) NOT NULL DEFAULT 'other',
	`tags` json NOT NULL DEFAULT (json_array()),
	`source` varchar(64) NOT NULL DEFAULT 'web',
	`post_text` longtext,
	`transcript` longtext,
	`summary` longtext,
	`claims` json,
	`media_asset_id` int,
	`telegram_file_id` varchar(255),
	`fetched_at` datetime(3),
	`ingest_started_at` datetime(3),
	`learn_category` varchar(64),
	`how_to_start` json,
	`implemented_at` datetime(3),
	`committed_at` datetime(3),
	CONSTRAINT `clips_id` PRIMARY KEY(`id`),
	CONSTRAINT `clips_url_hash_idx` UNIQUE(`url_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `comment_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_id` int NOT NULL,
	`post_id` int,
	`platform` varchar(64) NOT NULL,
	`external_comment_id` varchar(128) NOT NULL,
	`external_media_id` varchar(128),
	`author` varchar(255),
	`comment_text` longtext NOT NULL,
	`commented_at` datetime(3),
	`language` varchar(8),
	`draft` longtext,
	`status` varchar(64) NOT NULL DEFAULT 'new',
	`error` varchar(1024),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `comment_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `comment_drafts_platform_comment_idx` UNIQUE(`platform`,`external_comment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `competitor_posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`competitor_id` int NOT NULL,
	`external_id` varchar(128) NOT NULL,
	`permalink` varchar(1024),
	`caption` longtext,
	`media_type` varchar(32),
	`posted_at` datetime(3),
	`likes` int,
	`comments` int,
	`views` int,
	`captured_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `competitor_posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `competitor_posts_external_id_idx` UNIQUE(`external_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `competitor_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255) NOT NULL,
	`period_days` int NOT NULL,
	`body` json NOT NULL,
	`cost_usd` decimal(10,6) NOT NULL DEFAULT '0',
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `competitor_reports_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `content_gaps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255) NOT NULL,
	`topic` longtext NOT NULL,
	`angle` longtext,
	`evidence` json NOT NULL DEFAULT (json_array()),
	`score` smallint,
	`status` varchar(64) NOT NULL DEFAULT 'new',
	`idea_id` int,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `content_gaps_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(128) NOT NULL,
	CONSTRAINT `entities_id` PRIMARY KEY(`id`),
	CONSTRAINT `entities_slug_idx` UNIQUE(`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `facts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255),
	`family_id` varchar(255),
	`external_key` varchar(255),
	`language` varchar(8) NOT NULL DEFAULT 'en',
	`verified` boolean NOT NULL DEFAULT false,
	`topic` longtext NOT NULL,
	`claim` longtext NOT NULL,
	`source_url` varchar(1024),
	`last_checked_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`notes` longtext,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `facts_id` PRIMARY KEY(`id`),
	CONSTRAINT `facts_family_key_language_idx` UNIQUE(`family_id`,`external_key`,`language`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `glossary_terms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`term` varchar(255) NOT NULL,
	`language` varchar(8) NOT NULL DEFAULT 'gn',
	`meaning_es` longtext,
	`meaning_en` longtext,
	`say_as` longtext,
	`part_of_speech` varchar(32),
	`register` varchar(64) NOT NULL DEFAULT 'everyday',
	`jopara_ok` boolean NOT NULL DEFAULT false,
	`example` longtext,
	`example_translation` longtext,
	`review_status` varchar(64) NOT NULL DEFAULT 'proposed',
	`reviewed_by` varchar(255),
	`reviewed_at` datetime(3),
	`source` varchar(255),
	`notes` longtext,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `glossary_terms_id` PRIMARY KEY(`id`),
	CONSTRAINT `glossary_terms_term_language_idx` UNIQUE(`term`,`language`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `higgsfield_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` varchar(64) NOT NULL,
	`target_ref` varchar(255),
	`brand_id` varchar(255),
	`prompt` longtext NOT NULL,
	`max_credits` double NOT NULL,
	`credits_used` double,
	`status` varchar(64) NOT NULL DEFAULT 'queued',
	`external_job_ids` json NOT NULL DEFAULT (json_array()),
	`output_paths` json NOT NULL DEFAULT (json_array()),
	`log` longtext,
	`error` varchar(1024),
	`pid` int,
	`worker_host` varchar(255),
	`worker_instance` varchar(64),
	`lease_name` varchar(255),
	`lease_holder` varchar(64),
	`heartbeat_at` datetime(3),
	`recovery_of_job_id` int,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `higgsfield_jobs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255) NOT NULL,
	`title` longtext NOT NULL,
	`angle` longtext NOT NULL,
	`format` varchar(64) NOT NULL,
	`platform` varchar(64) NOT NULL,
	`draft_copy` longtext NOT NULL,
	`visual_notes` longtext,
	`research_note_id` int,
	`source_analysis_id` int,
	`citations` json,
	`status` varchar(64) NOT NULL DEFAULT 'proposed',
	`posted_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `ideas_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(64) NOT NULL,
	`label` varchar(255) NOT NULL,
	`account_ref` varchar(255),
	`token_ciphertext` longtext,
	`credential_version` int NOT NULL DEFAULT 0,
	`token_expires_at` datetime(3),
	`scopes` json NOT NULL DEFAULT (json_array()),
	`status` varchar(64) NOT NULL DEFAULT 'ok',
	`last_error` varchar(1024),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `integrations_provider_account_idx` UNIQUE(`provider`,`account_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `leases` (
	`name` varchar(255) NOT NULL,
	`holder` varchar(255) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `leases_name` PRIMARY KEY(`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`text` longtext NOT NULL,
	`kind` varchar(64) NOT NULL DEFAULT 'lesson',
	`brand_id` varchar(255),
	`family_id` varchar(255),
	`video_id` int,
	`timestamp_sec` int,
	`source_url` varchar(1024),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `lessons_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `narrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`owner_kind` varchar(64) NOT NULL,
	`owner_ref` varchar(255) NOT NULL,
	`scene_ref` varchar(64),
	`language` varchar(8) NOT NULL,
	`voice_profile_id` int,
	`speaker` varchar(128),
	`input_text` longtext NOT NULL,
	`spoken_text` longtext,
	`text_hash` char(64) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'pending',
	`master_asset_id` int,
	`playback_asset_id` int,
	`duration_ms` int,
	`alignment` json,
	`cost_usd` double NOT NULL DEFAULT 0,
	`cost_credits` double,
	`higgsfield_job_id` int,
	`external_ref` varchar(255),
	`selected` boolean NOT NULL DEFAULT false,
	`review_status` varchar(64) NOT NULL DEFAULT 'unreviewed',
	`review_note` longtext,
	`reviewed_by` varchar(255),
	`error` varchar(1024),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `narrations_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `outlines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`analysis_id` int NOT NULL,
	`idea_index` smallint NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'ok',
	`error` varchar(1024),
	`content` json,
	`raw_response` longtext,
	`model` varchar(64),
	`cost_usd` decimal(10,6) NOT NULL DEFAULT '0',
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `outlines_id` PRIMARY KEY(`id`),
	CONSTRAINT `outlines_analysis_idea_idx` UNIQUE(`analysis_id`,`idea_index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `post_assets` (
	`post_id` int NOT NULL,
	`asset_id` int NOT NULL,
	`position` smallint NOT NULL,
	`role` varchar(64) NOT NULL DEFAULT 'slide',
	CONSTRAINT `post_assets_post_id_position_pk` PRIMARY KEY(`post_id`,`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `post_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`post_id` int NOT NULL,
	`captured_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`reach` int,
	`impressions` int,
	`plays` int,
	`likes` int,
	`comments` int,
	`saves` int,
	`shares` int,
	`follows` int,
	`profile_visits` int,
	`raw` json,
	CONSTRAINT `post_metrics_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_id` int NOT NULL,
	`brand_id` varchar(255) NOT NULL,
	`idea_id` int,
	`parent_post_id` int,
	`format` varchar(64) NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'idea',
	`title` longtext NOT NULL DEFAULT '',
	`body` json,
	`caption` longtext,
	`first_comment` longtext,
	`notes` longtext,
	`scheduled_for` datetime(3),
	`published_at` datetime(3),
	`permalink` varchar(1024),
	`external_media_id` varchar(128),
	`external_container_id` varchar(128),
	`publish_error` varchar(1024),
	`publish_attempts` int NOT NULL DEFAULT 0,
	`revision` int NOT NULL DEFAULT 0,
	`publish_attempt_id` varchar(36),
	`publish_state` varchar(64) NOT NULL DEFAULT 'idle',
	`publish_target` json,
	`publish_approved_revision` int,
	`publish_approved_by` int,
	`publish_approved_at` datetime(3),
	`publish_started_at` datetime(3),
	`publish_upload` json,
	`last_publish_attempt_at` datetime(3),
	`lead_url` varchar(1024),
	`publish_options` json,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `posts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `pronunciations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`term` varchar(255) NOT NULL,
	`say_as` longtext NOT NULL,
	`language` varchar(8) NOT NULL DEFAULT '*',
	`scope` varchar(128) NOT NULL DEFAULT 'global',
	`review_status` varchar(64) NOT NULL DEFAULT 'proposed',
	`reviewed_by` varchar(255),
	`reviewed_at` datetime(3),
	`notes` longtext,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `pronunciations_id` PRIMARY KEY(`id`),
	CONSTRAINT `pronunciations_term_language_scope_idx` UNIQUE(`term`,`language`,`scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `research_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`topic` longtext NOT NULL,
	`summary` longtext NOT NULL,
	`market` varchar(255) NOT NULL,
	`related_brand_ids` json NOT NULL,
	`sources` json,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `research_notes_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `screenings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`video_id` int NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'ok',
	`score` smallint,
	`reason` varchar(512),
	`model` varchar(64) NOT NULL,
	`prompt_version` smallint NOT NULL DEFAULT 1,
	`error` varchar(1024),
	`raw_response` longtext,
	`input_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`cost_usd` decimal(10,6) NOT NULL DEFAULT '0',
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `screenings_id` PRIMARY KEY(`id`),
	CONSTRAINT `screenings_video_id_idx` UNIQUE(`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `script_derivatives` (
	`id` int AUTO_INCREMENT NOT NULL,
	`script_id` int NOT NULL,
	`kind` varchar(64) NOT NULL,
	`content` longtext NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `script_derivatives_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255) NOT NULL,
	`idea_id` int,
	`title` longtext NOT NULL,
	`language` varchar(16) NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'draft',
	`body` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`recorded_at` datetime(3),
	`posted_at` datetime(3),
	`youtube_url` varchar(512),
	`publish_pack` json,
	`thumbnail_file` varchar(512),
	`parent_script_id` int,
	CONSTRAINT `scripts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255) NOT NULL,
	`platform` varchar(64) NOT NULL,
	`handle` varchar(255) NOT NULL,
	`language` varchar(8),
	`status` varchar(64) NOT NULL DEFAULT 'planned',
	`is_professional` boolean NOT NULL DEFAULT false,
	`external_id` varchar(128),
	`integration_id` int,
	`notes` longtext,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `social_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `social_accounts_platform_handle_idx` UNIQUE(`platform`,`handle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `social_competitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand_id` varchar(255) NOT NULL,
	`platform` varchar(64) NOT NULL,
	`handle` varchar(255) NOT NULL,
	`role` varchar(64) NOT NULL DEFAULT 'competitor',
	`external_id` varchar(128),
	`followers` int,
	`last_synced_at` datetime(3),
	`last_error` varchar(1024),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `social_competitors_id` PRIMARY KEY(`id`),
	CONSTRAINT `social_competitors_brand_platform_handle_idx` UNIQUE(`brand_id`,`platform`,`handle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` varchar(64) NOT NULL,
	`youtube_id` varchar(64) NOT NULL,
	`title` varchar(512) NOT NULL,
	`url` varchar(512) NOT NULL,
	`last_polled_at` datetime(3),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `sources_youtube_id_idx` UNIQUE(`youtube_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `spend_holds` (
	`id` varchar(36) NOT NULL,
	`owner` varchar(255) NOT NULL,
	`estimated_usd` decimal(10,6) NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'held',
	`expires_at` datetime(3) NOT NULL,
	`accounted_day` date,
	`actual_usd` decimal(10,6),
	`settled_usd` decimal(10,6) NOT NULL DEFAULT '0',
	`uncertain_usd` decimal(10,6),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `spend_holds_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `spend_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`day` date NOT NULL,
	`cost_usd` decimal(10,6) NOT NULL DEFAULT '0',
	CONSTRAINT `spend_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `spend_log_day_idx` UNIQUE(`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `spend_reservation` (
	`id` int NOT NULL,
	`reserved_usd` decimal(10,6) NOT NULL DEFAULT '0',
	CONSTRAINT `spend_reservation_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(255) NOT NULL,
	`title` longtext NOT NULL,
	`series` varchar(255),
	`age_band` longtext,
	`source_path` varchar(1024) NOT NULL,
	`source_sha` char(64),
	`raw` json,
	`languages` json NOT NULL DEFAULT (json_array()),
	`brand_id` varchar(255),
	`notes` longtext,
	`imported_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `stories_id` PRIMARY KEY(`id`),
	CONSTRAINT `stories_slug_idx` UNIQUE(`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `story_scenes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`story_id` int NOT NULL,
	`scene_ref` varchar(64) NOT NULL,
	`position` smallint NOT NULL,
	`kind` varchar(64) NOT NULL DEFAULT 'page',
	`text` json NOT NULL DEFAULT (json_object()),
	`text_status` json NOT NULL DEFAULT (json_object()),
	`lines` json NOT NULL DEFAULT (json_object()),
	`art_path` varchar(1024),
	`art_width` int,
	`art_height` int,
	`alt` longtext,
	`art_brief` longtext,
	`notes` longtext,
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `story_scenes_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_scenes_story_scene_idx` UNIQUE(`story_id`,`scene_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(128) NOT NULL,
	CONSTRAINT `topics_id` PRIMARY KEY(`id`),
	CONSTRAINT `topics_slug_idx` UNIQUE(`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `transcripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`video_id` int NOT NULL,
	`language` varchar(16),
	`source` varchar(64) NOT NULL DEFAULT 'captions',
	`word_count` int NOT NULL DEFAULT 0,
	`content` longtext NOT NULL,
	`fetched_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `transcripts_id` PRIMARY KEY(`id`),
	CONSTRAINT `transcripts_video_id_idx` UNIQUE(`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `yt_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` varchar(64) NOT NULL DEFAULT 'employee',
	`password_hash` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `yt_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `yt_users_email_unique` UNIQUE(`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `video_entities` (
	`video_id` int NOT NULL,
	`entity_id` int NOT NULL,
	CONSTRAINT `video_entities_video_id_entity_id_pk` PRIMARY KEY(`video_id`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `video_reads` (
	`video_id` int NOT NULL,
	`user_id` int NOT NULL,
	`read_at` datetime(3),
	`pinned` boolean NOT NULL DEFAULT false,
	CONSTRAINT `video_reads_video_id_user_id_pk` PRIMARY KEY(`video_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `video_renders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`owner_kind` varchar(64) NOT NULL,
	`owner_ref` varchar(255) NOT NULL,
	`language` varchar(8) NOT NULL,
	`format` varchar(64) NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'queued',
	`plan` json,
	`output_asset_id` int,
	`srt_asset_id` int,
	`vtt_asset_id` int,
	`duration_ms` int,
	`error` varchar(1024),
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `video_renders_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `video_topics` (
	`video_id` int NOT NULL,
	`topic_id` int NOT NULL,
	CONSTRAINT `video_topics_video_id_topic_id_pk` PRIMARY KEY(`video_id`,`topic_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `video_unit_marks` (
	`video_id` int NOT NULL,
	`user_id` int NOT NULL,
	`unit_type` varchar(64) NOT NULL,
	`unit_index` int NOT NULL,
	`unit_text` varchar(1024) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `video_unit_marks_video_id_user_id_unit_type_unit_index_pk` PRIMARY KEY(`video_id`,`user_id`,`unit_type`,`unit_index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`youtube_id` varchar(16) NOT NULL,
	`source_id` int,
	`title` varchar(512) NOT NULL,
	`description` longtext,
	`channel_title` varchar(255),
	`published_at` datetime(3),
	`duration_seconds` int,
	`view_count` bigint,
	`like_count` bigint,
	`comment_count` bigint,
	`thumbnail_url` varchar(512),
	`caption_status` varchar(64) NOT NULL DEFAULT 'unknown',
	`caption_checked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `videos_id` PRIMARY KEY(`id`),
	CONSTRAINT `videos_youtube_id_idx` UNIQUE(`youtube_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE TABLE `voice_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`provider_voice_id` varchar(255),
	`languages` json NOT NULL DEFAULT (json_array()),
	`role` varchar(64) NOT NULL DEFAULT 'narrator',
	`character_key` varchar(128),
	`brand_id` varchar(255),
	`settings` json NOT NULL DEFAULT (json_object()),
	`consent_status` varchar(64) NOT NULL DEFAULT 'not_needed',
	`consent_person` varchar(255),
	`consent_scope` longtext,
	`consent_doc_path` varchar(1024),
	`consent_signed_at` datetime(3),
	`consent_expires_at` datetime(3),
	`active` boolean NOT NULL DEFAULT true,
	`notes` longtext,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `voice_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `voice_profiles_key_idx` UNIQUE(`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
--> statement-breakpoint
CREATE INDEX `analyses_video_idx` ON `analyses` (`video_id`);--> statement-breakpoint
CREATE INDEX `analyses_status_idx` ON `analyses` (`status`);--> statement-breakpoint
CREATE INDEX `analyses_batch_idx` ON `analyses` (`batch_id`);--> statement-breakpoint
CREATE INDEX `assets_brand_status_idx` ON `assets` (`brand_id`,`status`);--> statement-breakpoint
CREATE INDEX `assets_created_idx` ON `assets` (`created_at`);--> statement-breakpoint
CREATE INDEX `assets_account_idx` ON `assets` (`account_id`);--> statement-breakpoint
CREATE INDEX `audience_questions_brand_idx` ON `audience_questions` (`brand_id`,`status`);--> statement-breakpoint
CREATE INDEX `batches_status_idx` ON `batches` (`status`);--> statement-breakpoint
CREATE INDEX `brand_sources_source_idx` ON `brand_sources` (`source_id`);--> statement-breakpoint
CREATE INDEX `clips_status_idx` ON `clips` (`status`);--> statement-breakpoint
CREATE INDEX `clips_saved_idx` ON `clips` (`saved_at`);--> statement-breakpoint
CREATE INDEX `clips_brand_idx` ON `clips` (`brand_id`);--> statement-breakpoint
CREATE INDEX `clips_purpose_idx` ON `clips` (`purpose`);--> statement-breakpoint
CREATE INDEX `comment_drafts_account_status_idx` ON `comment_drafts` (`account_id`,`status`);--> statement-breakpoint
CREATE INDEX `competitor_posts_competitor_posted_idx` ON `competitor_posts` (`competitor_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `competitor_reports_brand_idx` ON `competitor_reports` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_gaps_brand_status_idx` ON `content_gaps` (`brand_id`,`status`);--> statement-breakpoint
CREATE INDEX `facts_brand_topic_idx` ON `facts` (`brand_id`,`topic`);--> statement-breakpoint
CREATE INDEX `facts_family_topic_idx` ON `facts` (`family_id`,`topic`);--> statement-breakpoint
CREATE INDEX `glossary_terms_review_idx` ON `glossary_terms` (`review_status`);--> statement-breakpoint
CREATE INDEX `higgsfield_jobs_status_idx` ON `higgsfield_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `higgsfield_jobs_target_idx` ON `higgsfield_jobs` (`target_ref`);--> statement-breakpoint
CREATE INDEX `integrations_provider_idx` ON `integrations` (`provider`,`status`);--> statement-breakpoint
CREATE INDEX `lessons_brand_kind_idx` ON `lessons` (`brand_id`,`kind`);--> statement-breakpoint
CREATE INDEX `lessons_video_idx` ON `lessons` (`video_id`);--> statement-breakpoint
CREATE INDEX `lessons_family_kind_idx` ON `lessons` (`family_id`,`kind`);--> statement-breakpoint
CREATE INDEX `narrations_owner_idx` ON `narrations` (`owner_kind`,`owner_ref`,`scene_ref`,`language`);--> statement-breakpoint
CREATE INDEX `narrations_voice_idx` ON `narrations` (`voice_profile_id`);--> statement-breakpoint
CREATE INDEX `post_assets_asset_idx` ON `post_assets` (`asset_id`);--> statement-breakpoint
CREATE INDEX `post_metrics_post_captured_idx` ON `post_metrics` (`post_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `posts_account_status_idx` ON `posts` (`account_id`,`status`);--> statement-breakpoint
CREATE INDEX `posts_scheduled_idx` ON `posts` (`scheduled_for`);--> statement-breakpoint
CREATE INDEX `posts_brand_status_idx` ON `posts` (`brand_id`,`status`);--> statement-breakpoint
CREATE INDEX `posts_parent_idx` ON `posts` (`parent_post_id`);--> statement-breakpoint
CREATE INDEX `screenings_score_idx` ON `screenings` (`score`);--> statement-breakpoint
CREATE INDEX `script_derivatives_script_idx` ON `script_derivatives` (`script_id`);--> statement-breakpoint
CREATE INDEX `scripts_brand_status_idx` ON `scripts` (`brand_id`,`status`);--> statement-breakpoint
CREATE INDEX `scripts_updated_idx` ON `scripts` (`updated_at`);--> statement-breakpoint
CREATE INDEX `social_accounts_brand_idx` ON `social_accounts` (`brand_id`);--> statement-breakpoint
CREATE INDEX `sources_active_polled_idx` ON `sources` (`active`,`last_polled_at`);--> statement-breakpoint
CREATE INDEX `video_entities_entity_idx` ON `video_entities` (`entity_id`);--> statement-breakpoint
CREATE INDEX `video_reads_user_read_idx` ON `video_reads` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `video_reads_user_pinned_idx` ON `video_reads` (`user_id`,`pinned`);--> statement-breakpoint
CREATE INDEX `video_renders_owner_idx` ON `video_renders` (`owner_kind`,`owner_ref`,`language`);--> statement-breakpoint
CREATE INDEX `video_topics_topic_idx` ON `video_topics` (`topic_id`);--> statement-breakpoint
CREATE INDEX `video_unit_marks_user_created_idx` ON `video_unit_marks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `videos_source_idx` ON `videos` (`source_id`);--> statement-breakpoint
CREATE INDEX `videos_published_idx` ON `videos` (`published_at`);--> statement-breakpoint
CREATE INDEX `videos_caption_status_idx` ON `videos` (`caption_status`);--> statement-breakpoint
CREATE INDEX `videos_created_idx` ON `videos` (`created_at`);--> statement-breakpoint
CREATE INDEX `voice_profiles_character_idx` ON `voice_profiles` (`character_key`);