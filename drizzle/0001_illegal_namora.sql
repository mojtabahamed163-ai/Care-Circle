CREATE TABLE `careEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`kind` enum('appointment','visit') NOT NULL DEFAULT 'appointment',
	`startsAt` timestamp NOT NULL,
	`location` varchar(240),
	`escortId` int,
	`reminderMinutes` int NOT NULL DEFAULT 60,
	`questions` text,
	`visitNotes` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `careEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `careNotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`kind` enum('update','visit_note','question','handoff','need') NOT NULL DEFAULT 'update',
	`body` text NOT NULL,
	`isConfirmedFact` boolean NOT NULL DEFAULT false,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `careNotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `careTasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text,
	`dueAt` timestamp,
	`priority` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`assigneeId` int,
	`status` enum('new','in_progress','completed') NOT NULL DEFAULT 'new',
	`recurrence` enum('none','daily','weekly','monthly') NOT NULL DEFAULT 'none',
	`notes` text,
	`createdBy` int NOT NULL,
	`completedBy` int,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `careTasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `doseConfirmations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`medicationId` int NOT NULL,
	`doseDate` varchar(10) NOT NULL,
	`status` enum('confirmed','needs_follow_up') NOT NULL DEFAULT 'confirmed',
	`note` text,
	`confirmedBy` int NOT NULL,
	`confirmedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `doseConfirmations_id` PRIMARY KEY(`id`),
	CONSTRAINT `doseConfirmations_med_date_uq` UNIQUE(`medicationId`,`doseDate`)
);
--> statement-breakpoint
CREATE TABLE `families` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `families_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `familyInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`email` varchar(320),
	`role` enum('coordinator','caregiver','viewer') NOT NULL DEFAULT 'caregiver',
	`tokenHash` varchar(64) NOT NULL,
	`status` enum('pending','accepted','declined','revoked') NOT NULL DEFAULT 'pending',
	`invitedBy` int NOT NULL,
	`acceptedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `familyInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `familyInvitations_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `familyMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','coordinator','caregiver','viewer') NOT NULL DEFAULT 'caregiver',
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `familyMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `familyMembers_family_user_uq` UNIQUE(`familyId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `medications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`dose` varchar(180) NOT NULL,
	`schedule` varchar(240) NOT NULL,
	`startDate` varchar(10),
	`endDate` varchar(10),
	`notes` text,
	`assigneeId` int,
	`active` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `medications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `careEvents` ADD CONSTRAINT `careEvents_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careEvents` ADD CONSTRAINT `careEvents_escortId_users_id_fk` FOREIGN KEY (`escortId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careEvents` ADD CONSTRAINT `careEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careNotes` ADD CONSTRAINT `careNotes_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careNotes` ADD CONSTRAINT `careNotes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careTasks` ADD CONSTRAINT `careTasks_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careTasks` ADD CONSTRAINT `careTasks_assigneeId_users_id_fk` FOREIGN KEY (`assigneeId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careTasks` ADD CONSTRAINT `careTasks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careTasks` ADD CONSTRAINT `careTasks_completedBy_users_id_fk` FOREIGN KEY (`completedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doseConfirmations` ADD CONSTRAINT `doseConfirmations_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doseConfirmations` ADD CONSTRAINT `doseConfirmations_medicationId_medications_id_fk` FOREIGN KEY (`medicationId`) REFERENCES `medications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doseConfirmations` ADD CONSTRAINT `doseConfirmations_confirmedBy_users_id_fk` FOREIGN KEY (`confirmedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `families` ADD CONSTRAINT `families_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `familyInvitations` ADD CONSTRAINT `familyInvitations_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `familyInvitations` ADD CONSTRAINT `familyInvitations_invitedBy_users_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `familyInvitations` ADD CONSTRAINT `familyInvitations_acceptedBy_users_id_fk` FOREIGN KEY (`acceptedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `familyMembers` ADD CONSTRAINT `familyMembers_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `familyMembers` ADD CONSTRAINT `familyMembers_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medications` ADD CONSTRAINT `medications_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medications` ADD CONSTRAINT `medications_assigneeId_users_id_fk` FOREIGN KEY (`assigneeId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medications` ADD CONSTRAINT `medications_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `careEvents_family_start_idx` ON `careEvents` (`familyId`,`startsAt`);--> statement-breakpoint
CREATE INDEX `careNotes_family_created_idx` ON `careNotes` (`familyId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `careTasks_family_due_idx` ON `careTasks` (`familyId`,`dueAt`);--> statement-breakpoint
CREATE INDEX `careTasks_assignee_idx` ON `careTasks` (`assigneeId`);--> statement-breakpoint
CREATE INDEX `doseConfirmations_family_date_idx` ON `doseConfirmations` (`familyId`,`doseDate`);--> statement-breakpoint
CREATE INDEX `familyInvitations_family_status_idx` ON `familyInvitations` (`familyId`,`status`);--> statement-breakpoint
CREATE INDEX `familyMembers_user_idx` ON `familyMembers` (`userId`);--> statement-breakpoint
CREATE INDEX `medications_family_active_idx` ON `medications` (`familyId`,`active`);