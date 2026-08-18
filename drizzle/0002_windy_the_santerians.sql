ALTER TABLE `user_ai_preferences` ADD `engine` text DEFAULT 'openai' NOT NULL;
--> statement-breakpoint
UPDATE `user_ai_preferences`
SET `engine` = 'custom'
WHERE lower(rtrim(`endpoint`, '/')) <> 'https://api.openai.com/v1/responses';
