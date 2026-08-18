CREATE TABLE `global_ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`engine` text DEFAULT 'openai' NOT NULL,
	`endpoint` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text DEFAULT 'low' NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
