CREATE TABLE `careAbsences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`memberId` int NOT NULL,
	`createdBy` int NOT NULL,
	`startDate` varchar(10) NOT NULL,
	`endDate` varchar(10) NOT NULL,
	`note` varchar(1000),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `careAbsences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `careAuditLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`actorId` int NOT NULL,
	`action` varchar(48) NOT NULL,
	`resourceType` varchar(24) NOT NULL,
	`resourceId` int,
	`previousValues` json,
	`newValues` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `careAuditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `careHandoffs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`eventId` int NOT NULL,
	`fromUserId` int NOT NULL,
	`recipientId` int NOT NULL,
	`context` text NOT NULL,
	`pendingTaskIds` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `careHandoffs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `taskCollaborationRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`taskId` int NOT NULL,
	`kind` enum('help','swap') NOT NULL,
	`requesterId` int NOT NULL,
	`targetId` int NOT NULL,
	`status` enum('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
	`taskSnapshot` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`respondedAt` timestamp,
	CONSTRAINT `taskCollaborationRequests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `careAbsences` ADD CONSTRAINT `careAbsences_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careAbsences` ADD CONSTRAINT `careAbsences_memberId_users_id_fk` FOREIGN KEY (`memberId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careAbsences` ADD CONSTRAINT `careAbsences_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careAuditLog` ADD CONSTRAINT `careAuditLog_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careAuditLog` ADD CONSTRAINT `careAuditLog_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careHandoffs` ADD CONSTRAINT `careHandoffs_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careHandoffs` ADD CONSTRAINT `careHandoffs_eventId_careEvents_id_fk` FOREIGN KEY (`eventId`) REFERENCES `careEvents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careHandoffs` ADD CONSTRAINT `careHandoffs_fromUserId_users_id_fk` FOREIGN KEY (`fromUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careHandoffs` ADD CONSTRAINT `careHandoffs_recipientId_users_id_fk` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `taskCollaborationRequests` ADD CONSTRAINT `taskCollaborationRequests_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `taskCollaborationRequests` ADD CONSTRAINT `taskCollaborationRequests_taskId_careTasks_id_fk` FOREIGN KEY (`taskId`) REFERENCES `careTasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `taskCollaborationRequests` ADD CONSTRAINT `taskCollaborationRequests_requesterId_users_id_fk` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `taskCollaborationRequests` ADD CONSTRAINT `taskCollaborationRequests_targetId_users_id_fk` FOREIGN KEY (`targetId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `careAbsences_family_dates_idx` ON `careAbsences` (`familyId`,`startDate`,`endDate`);--> statement-breakpoint
CREATE INDEX `careAbsences_member_dates_idx` ON `careAbsences` (`memberId`,`startDate`,`endDate`);--> statement-breakpoint
CREATE INDEX `careAuditLog_family_created_idx` ON `careAuditLog` (`familyId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `careHandoffs_family_created_idx` ON `careHandoffs` (`familyId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `careHandoffs_recipient_idx` ON `careHandoffs` (`recipientId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `taskCollaboration_family_status_idx` ON `taskCollaborationRequests` (`familyId`,`status`);--> statement-breakpoint
CREATE INDEX `taskCollaboration_task_status_idx` ON `taskCollaborationRequests` (`taskId`,`status`);--> statement-breakpoint
CREATE INDEX `taskCollaboration_target_status_idx` ON `taskCollaborationRequests` (`targetId`,`status`);