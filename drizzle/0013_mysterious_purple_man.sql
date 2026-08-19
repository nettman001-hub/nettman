CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`reason` text NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text DEFAULT '{}' NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_admin_audit_logs_target_created` ON `admin_audit_logs` (`target_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_audit_logs_actor_created` ON `admin_audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_admin_audit_logs_request` ON `admin_audit_logs` (`request_id`);--> statement-breakpoint
CREATE TABLE `token_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`transaction_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_token_adjustments_idempotency` ON `token_adjustments` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_token_adjustments_transaction` ON `token_adjustments` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_token_adjustments_user_created` ON `token_adjustments` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_auth_sessions` (
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_auth_sessions_user_session` ON `user_auth_sessions` (`user_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `idx_user_auth_sessions_user_revoked` ON `user_auth_sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_until` text;--> statement-breakpoint
ALTER TABLE `users` ADD `status_changed_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `status_changed_by` text;--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_users_created` ON `users` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_users_status_created` ON `users` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_users_role_created` ON `users` (`role`,`created_at`,`id`);