import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const families = mysqlTable("families", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  createdBy: int("createdBy")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const familyMembers = mysqlTable(
  "familyMembers",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    userId: int("userId")
      .notNull()
      .references(() => users.id),
    role: mysqlEnum("role", ["owner", "coordinator", "caregiver", "viewer"])
      .default("caregiver")
      .notNull(),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  },
  table => ({
    familyUser: uniqueIndex("familyMembers_family_user_uq").on(
      table.familyId,
      table.userId
    ),
    userLookup: index("familyMembers_user_idx").on(table.userId),
  })
);

export const familyInvitations = mysqlTable(
  "familyInvitations",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    email: varchar("email", { length: 320 }),
    role: mysqlEnum("role", ["coordinator", "caregiver", "viewer"])
      .default("caregiver")
      .notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    status: mysqlEnum("status", ["pending", "accepted", "declined", "revoked"])
      .default("pending")
      .notNull(),
    invitedBy: int("invitedBy")
      .notNull()
      .references(() => users.id),
    acceptedBy: int("acceptedBy").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
  },
  table => ({
    familyStatus: index("familyInvitations_family_status_idx").on(
      table.familyId,
      table.status
    ),
  })
);

export const careTasks = mysqlTable(
  "careTasks",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description"),
    dueAt: timestamp("dueAt"),
    priority: mysqlEnum("priority", ["low", "medium", "high"])
      .default("medium")
      .notNull(),
    assigneeId: int("assigneeId").references(() => users.id),
    status: mysqlEnum("status", ["new", "in_progress", "completed"])
      .default("new")
      .notNull(),
    recurrence: mysqlEnum("recurrence", ["none", "daily", "weekly", "monthly"])
      .default("none")
      .notNull(),
    notes: text("notes"),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id),
    completedBy: int("completedBy").references(() => users.id),
    completedAt: timestamp("completedAt"),
    generatedFromTaskId: int("generatedFromTaskId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    familyDue: index("careTasks_family_due_idx").on(
      table.familyId,
      table.dueAt
    ),
    assignee: index("careTasks_assignee_idx").on(table.assigneeId),
    generatedFrom: uniqueIndex("careTasks_generated_from_uq").on(
      table.generatedFromTaskId
    ),
  })
);

export const careTaskCompletions = mysqlTable(
  "careTaskCompletions",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    taskId: int("taskId")
      .notNull()
      .references(() => careTasks.id, { onDelete: "cascade" }),
    completedBy: int("completedBy")
      .notNull()
      .references(() => users.id),
    completedAt: timestamp("completedAt").defaultNow().notNull(),
  },
  table => ({
    familyTask: index("careTaskCompletions_family_task_idx").on(
      table.familyId,
      table.taskId,
      table.completedAt
    ),
  })
);

export const medications = mysqlTable(
  "medications",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    name: varchar("name", { length: 180 }).notNull(),
    dose: varchar("dose", { length: 180 }).notNull(),
    schedule: varchar("schedule", { length: 240 }).notNull(),
    doseTimes: varchar("doseTimes", { length: 240 }).notNull().default(""),
    timeZone: varchar("timeZone", { length: 64 }).notNull().default("UTC"),
    startDate: varchar("startDate", { length: 10 }),
    endDate: varchar("endDate", { length: 10 }),
    notes: text("notes"),
    assigneeId: int("assigneeId").references(() => users.id),
    active: boolean("active").default(true).notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    familyActive: index("medications_family_active_idx").on(
      table.familyId,
      table.active
    ),
  })
);

export const doseConfirmations = mysqlTable(
  "doseConfirmations",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    medicationId: int("medicationId")
      .notNull()
      .references(() => medications.id),
    doseDate: varchar("doseDate", { length: 10 }).notNull(),
    doseTime: varchar("doseTime", { length: 5 }).notNull().default("once"),
    status: mysqlEnum("status", ["confirmed", "needs_follow_up"])
      .default("confirmed")
      .notNull(),
    note: text("note"),
    confirmedBy: int("confirmedBy")
      .notNull()
      .references(() => users.id),
    confirmedAt: timestamp("confirmedAt").defaultNow().notNull(),
  },
  table => ({
    oneConfirmation: uniqueIndex("doseConfirmations_med_date_time_uq").on(
      table.medicationId,
      table.doseDate,
      table.doseTime
    ),
    familyDate: index("doseConfirmations_family_date_idx").on(
      table.familyId,
      table.doseDate
    ),
  })
);

export const careEvents = mysqlTable(
  "careEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    title: varchar("title", { length: 180 }).notNull(),
    kind: mysqlEnum("kind", ["appointment", "visit"])
      .default("appointment")
      .notNull(),
    startsAt: timestamp("startsAt").notNull(),
    timeZone: varchar("timeZone", { length: 64 }),
    location: varchar("location", { length: 240 }),
    escortId: int("escortId").references(() => users.id),
    reminderMinutes: int("reminderMinutes").default(60).notNull(),
    questions: text("questions"),
    visitNotes: text("visitNotes"),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    familyStart: index("careEvents_family_start_idx").on(
      table.familyId,
      table.startsAt
    ),
  })
);

export const careNotes = mysqlTable(
  "careNotes",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    kind: mysqlEnum("kind", [
      "update",
      "visit_note",
      "question",
      "handoff",
      "need",
    ])
      .default("update")
      .notNull(),
    body: text("body").notNull(),
    isConfirmedFact: boolean("isConfirmedFact").default(false).notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    familyCreated: index("careNotes_family_created_idx").on(
      table.familyId,
      table.createdAt
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
