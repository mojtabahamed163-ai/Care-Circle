ALTER TABLE `careEvents` ADD `timeZone` varchar(64);--> statement-breakpoint
ALTER TABLE `doseConfirmations` ADD `doseTime` varchar(5) DEFAULT 'once' NOT NULL;--> statement-breakpoint
ALTER TABLE `medications` ADD `doseTimes` varchar(240) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `medications` ADD `timeZone` varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `doseConfirmations` ADD CONSTRAINT `doseConfirmations_med_date_time_uq` UNIQUE(`medicationId`,`doseDate`,`doseTime`);--> statement-breakpoint
ALTER TABLE `doseConfirmations` DROP INDEX `doseConfirmations_med_date_uq`;
