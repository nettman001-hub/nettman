CREATE TABLE `sermon_helper_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`scripture` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`current_step_id` text DEFAULT 'brief' NOT NULL,
	`steps_json` text NOT NULL,
	`provenance_json` text DEFAULT '[]' NOT NULL,
	`provenance_mode` text DEFAULT 'pastor_assisted' NOT NULL,
	`completed_sermon_id` text,
	`completed_step_count` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_sermon_helper_projects_user_updated` ON `sermon_helper_projects` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sermon_helper_projects_user_status` ON `sermon_helper_projects` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sermon_helper_projects_completed_sermon` ON `sermon_helper_projects` (`completed_sermon_id`);
