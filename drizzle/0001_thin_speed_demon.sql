CREATE TABLE `user_ai_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`endpoint` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text DEFAULT 'low' NOT NULL,
	`updated_at` text NOT NULL
);
