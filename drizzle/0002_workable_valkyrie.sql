ALTER TABLE `careTasks` ADD `generatedFromTaskId` int;--> statement-breakpoint
ALTER TABLE `careTasks` ADD CONSTRAINT `careTasks_generated_from_uq` UNIQUE(`generatedFromTaskId`);