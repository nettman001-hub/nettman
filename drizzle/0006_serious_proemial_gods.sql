CREATE TABLE `sermon_generation_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`position` integer NOT NULL,
	`step` integer NOT NULL,
	`part_json` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`reasoning_effort` text,
	`elapsed_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_generation_parts_run_position_step` ON `sermon_generation_parts` (`generation_id`,`position`,`step`);