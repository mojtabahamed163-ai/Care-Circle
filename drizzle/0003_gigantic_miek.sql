CREATE TABLE `careTaskCompletions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int NOT NULL,
	`taskId` int NOT NULL,
	`completedBy` int NOT NULL,
	`completedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `careTaskCompletions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `careTaskCompletions` ADD CONSTRAINT `careTaskCompletions_familyId_families_id_fk` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careTaskCompletions` ADD CONSTRAINT `careTaskCompletions_taskId_careTasks_id_fk` FOREIGN KEY (`taskId`) REFERENCES `careTasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `careTaskCompletions` ADD CONSTRAINT `careTaskCompletions_completedBy_users_id_fk` FOREIGN KEY (`completedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `careTaskCompletions_family_task_idx` ON `careTaskCompletions` (`familyId`,`taskId`,`completedAt`);