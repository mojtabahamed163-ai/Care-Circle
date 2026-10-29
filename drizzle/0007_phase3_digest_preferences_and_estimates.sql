CREATE TABLE `careDigestPreferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`userId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `careDigestPreferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `careDigestPreferences_family_user_uq` UNIQUE(`familyId`,`userId`)
);
--> statement-breakpoint
ALTER TABLE `careTasks` ADD `estimatedMinutes` int;--> statement-breakpoint
ALTER TABLE `careDigestPreferences` ADD CONSTRAINT `careDigestPreferences_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careDigestPreferences` ADD CONSTRAINT `careDigestPreferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `careDigestPreferences_user_idx` ON `careDigestPreferences` (`userId`);