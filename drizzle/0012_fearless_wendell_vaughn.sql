CREATE TABLE `sermon_resource_usage` (
	`user_id` text NOT NULL,
	`usage_date` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`active_request_id` text,
	`active_started_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sermon_resource_usage_user_date` ON `sermon_resource_usage` (`user_id`,`usage_date`);--> statement-breakpoint
ALTER TABLE `sermon_drafts` ADD `audience_situation` text DEFAULT '일반' NOT NULL;--> statement-breakpoint
ALTER TABLE `sermons` ADD `audience_situation` text DEFAULT '일반' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `denomination` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `theology` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `phone` text DEFAULT '' NOT NULL;