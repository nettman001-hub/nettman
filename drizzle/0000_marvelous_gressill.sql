CREATE TABLE `consultation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`consultation_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_role` text NOT NULL,
	`body` text NOT NULL,
	`section` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_consultation_created` ON `consultation_messages` (`consultation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `consultations` (
	`id` text PRIMARY KEY NOT NULL,
	`sermon_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expert_id` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`queue_position` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_consultations_sermon_user` ON `consultations` (`sermon_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_consultations_user_updated` ON `consultations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_consultations_expert_status` ON `consultations` (`expert_id`,`status`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sermon_id` text,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deliveries_user_created` ON `notification_deliveries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`push_enabled` integer DEFAULT false NOT NULL,
	`completion_enabled` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sermon_alternatives` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`scripture` text NOT NULL,
	`introduction` text NOT NULL,
	`body_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alternatives_draft_position` ON `sermon_alternatives` (`draft_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_alternatives_draft` ON `sermon_alternatives` (`draft_id`);--> statement-breakpoint
CREATE TABLE `sermon_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic` text NOT NULL,
	`scripture` text DEFAULT '' NOT NULL,
	`sermon_type` text NOT NULL,
	`audience` text NOT NULL,
	`point_count` integer NOT NULL,
	`duration` integer NOT NULL,
	`emotion` text NOT NULL,
	`reference_mode` text DEFAULT 'auto' NOT NULL,
	`status` text DEFAULT 'options_valid' NOT NULL,
	`selected_alternative_id` text,
	`revision_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sermon_drafts_user_updated` ON `sermon_drafts` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sermon_drafts_status` ON `sermon_drafts` (`status`);--> statement-breakpoint
CREATE TABLE `sermon_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`instruction` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`body_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_versions_draft_number` ON `sermon_versions` (`draft_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `sermons` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`draft_id` text,
	`title` text NOT NULL,
	`scripture` text NOT NULL,
	`sermon_type` text NOT NULL,
	`audience` text NOT NULL,
	`point_count` integer NOT NULL,
	`duration` integer NOT NULL,
	`emotion` text NOT NULL,
	`body_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sermons_draft` ON `sermons` (`draft_id`);--> statement-breakpoint
CREATE INDEX `idx_sermons_user_created` ON `sermons` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sermons_user_title` ON `sermons` (`user_id`,`title`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`ministry_role` text DEFAULT '담임목사' NOT NULL,
	`church` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'preacher' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);