CREATE TABLE `sermon_generation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`position` integer NOT NULL,
	`alternative_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_generation_items_run_position` ON `sermon_generation_items` (`generation_id`,`position`);--> statement-breakpoint
CREATE TABLE `sermon_generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expected_count` integer NOT NULL,
	`ai_signature` text NOT NULL,
	`managed_allowed` integer DEFAULT -1 NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`provider` text DEFAULT 'pending' NOT NULL,
	`model` text,
	`reasoning_effort` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
