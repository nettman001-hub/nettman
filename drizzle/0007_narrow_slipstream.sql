CREATE TABLE `token_topups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`usd_cents` integer NOT NULL,
	`token_amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_checkout_session_id` text,
	`stripe_payment_intent_id` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_token_topups_checkout_session` ON `token_topups` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `idx_token_topups_user_created` ON `token_topups` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_token_topups_status` ON `token_topups` (`status`);--> statement-breakpoint
CREATE TABLE `token_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reference_id` text NOT NULL,
	`description` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_token_transactions_reference` ON `token_transactions` (`reference_id`);--> statement-breakpoint
CREATE INDEX `idx_token_transactions_user_created` ON `token_transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `token_wallets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 200 NOT NULL,
	`lifetime_purchased` integer DEFAULT 0 NOT NULL,
	`lifetime_spent` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
