CREATE TABLE `ai_agent_usage` (
	`user_id` text NOT NULL,
	`usage_date` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`active_request_id` text,
	`active_started_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ai_agent_usage_user_date` ON `ai_agent_usage` (`user_id`,`usage_date`);