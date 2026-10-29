CREATE TABLE `householdNeeds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`quantity` varchar(120),
	`priority` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`buyerId` int,
	`completed` boolean NOT NULL DEFAULT false,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `householdNeeds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `importantContacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`kind` enum('provider','clinic','family','emergency') NOT NULL,
	`name` varchar(180) NOT NULL,
	`organization` varchar(180),
	`phone` varchar(80),
	`email` varchar(320),
	`notes` varchar(1000),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `importantContacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `householdNeeds` ADD CONSTRAINT `householdNeeds_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `householdNeeds` ADD CONSTRAINT `householdNeeds_buyerId_users_id_fk` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `householdNeeds` ADD CONSTRAINT `householdNeeds_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `importantContacts` ADD CONSTRAINT `importantContacts_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `importantContacts` ADD CONSTRAINT `importantContacts_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `householdNeeds_family_completed_idx` ON `householdNeeds` (`familyId`,`completed`);--> statement-breakpoint
CREATE INDEX `householdNeeds_buyer_idx` ON `householdNeeds` (`buyerId`);--> statement-breakpoint
CREATE INDEX `importantContacts_family_kind_idx` ON `importantContacts` (`familyId`,`kind`);