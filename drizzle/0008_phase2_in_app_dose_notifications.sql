CREATE TABLE `notificationEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventKey` varchar(255) NOT NULL,
	`familyId` int NOT NULL,
	`medicationId` int NOT NULL,
	`doseDate` varchar(10) NOT NULL,
	`doseTime` varchar(5) NOT NULL,
	`recipientId` int NOT NULL,
	`kind` enum('due_reminder','unconfirmed_10m','escalation_20m') NOT NULL,
	`message` varchar(255) NOT NULL,
	`scheduledAt` timestamp NOT NULL,
	`status` enum('created','read','cancelled') NOT NULL DEFAULT 'created',
	`emailDeliveryStatus` enum('not_configured') NOT NULL DEFAULT 'not_configured',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`readAt` timestamp,
	CONSTRAINT `notificationEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `notificationEvents_eventKey_unique` UNIQUE(`eventKey`)
);
--> statement-breakpoint
CREATE TABLE `notificationPreferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`userId` int NOT NULL,
	`reminderOptIn` boolean NOT NULL DEFAULT false,
	`escalationOptIn` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notificationPreferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `notificationPreferences_family_user_uq` UNIQUE(`familyId`,`userId`)
);
--> statement-breakpoint
ALTER TABLE `medications` ADD `escalationRecipientId` int;--> statement-breakpoint
ALTER TABLE `notificationEvents` ADD CONSTRAINT `notificationEvents_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationEvents` ADD CONSTRAINT `notificationEvents_medicationId_medications_id_fk` FOREIGN KEY (`medicationId`) REFERENCES `medications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationEvents` ADD CONSTRAINT `notificationEvents_recipientId_users_id_fk` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationPreferences` ADD CONSTRAINT `notificationPreferences_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationPreferences` ADD CONSTRAINT `notificationPreferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notificationEvents_recipient_status_idx` ON `notificationEvents` (`familyId`,`recipientId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `notificationEvents_dose_idx` ON `notificationEvents` (`familyId`,`medicationId`,`doseDate`,`doseTime`);--> statement-breakpoint
CREATE INDEX `notificationPreferences_user_idx` ON `notificationPreferences` (`userId`);--> statement-breakpoint
ALTER TABLE `medications` ADD CONSTRAINT `medications_escalationRecipientId_users_id_fk` FOREIGN KEY (`escalationRecipientId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;