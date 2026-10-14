CREATE TABLE `application_settings` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `application_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `clips` ADD `learn_details` json;