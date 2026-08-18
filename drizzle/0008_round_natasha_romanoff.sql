CREATE TABLE `payment_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`provider` text DEFAULT 'portone' NOT NULL,
	`payment_method` text NOT NULL,
	`amount_krw` integer NOT NULL,
	`token_amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`transaction_id` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_orders_payment_id` ON `payment_orders` (`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_orders_user_created` ON `payment_orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payment_orders_status` ON `payment_orders` (`status`);