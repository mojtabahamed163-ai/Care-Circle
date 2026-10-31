CREATE TABLE `sessionRevocations` (
	`tokenHash` varchar(64) NOT NULL,
	`revokedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `sessionRevocations_tokenHash` PRIMARY KEY(`tokenHash`)
);
