CREATE TABLE `managed_ai_usage` (
	`user_id` text NOT NULL,
	`usage_date` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_ai_usage_user_date` ON `managed_ai_usage` (`user_id`,`usage_date`);