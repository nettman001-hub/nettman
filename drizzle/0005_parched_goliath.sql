CREATE TABLE `sermon_generation_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`position` integer NOT NULL,
	`lease_token` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_generation_claims_run_position` ON `sermon_generation_claims` (`generation_id`,`position`);--> statement-breakpoint
ALTER TABLE `sermon_drafts` ADD `active_generation_id` text;