CREATE TABLE `sermon_helper_coach_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`tier` text NOT NULL,
	`mode` text NOT NULL,
	`step_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'succeeded', 'refunded')),
	`cost` integer NOT NULL CHECK (`cost` >= 1 AND `cost` <= 4),
	`charge_reference_id` text NOT NULL,
	`response_json` text,
	`failure_code` text,
	`lease_expires_at` text NOT NULL,
	`response_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`refunded_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sermon_helper_coach_user_session_message` ON `sermon_helper_coach_requests` (`user_id`,`session_id`,`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sermon_helper_coach_charge_reference` ON `sermon_helper_coach_requests` (`charge_reference_id`);--> statement-breakpoint
CREATE INDEX `idx_sermon_helper_coach_user_status_lease` ON `sermon_helper_coach_requests` (`user_id`,`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `idx_sermon_helper_coach_user_response_expiry` ON `sermon_helper_coach_requests` (`user_id`,`response_expires_at`);
