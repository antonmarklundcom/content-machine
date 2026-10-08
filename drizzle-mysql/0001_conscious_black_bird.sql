ALTER TABLE `spend_holds` ADD `recovery_note` varchar(1024);--> statement-breakpoint
ALTER TABLE `analyses` ADD CONSTRAINT `analyses_batch_video_idx` UNIQUE(`batch_id`,`video_id`);