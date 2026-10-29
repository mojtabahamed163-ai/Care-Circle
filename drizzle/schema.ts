import {
  boolean,
  index,
  int,
  json,
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
    estimatedMinutes: int("estimatedMinutes"),
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
    escalationRecipientId: int("escalationRecipientId").references(() => users.id),
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

export const householdNeeds = mysqlTable(
  "householdNeeds",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    name: varchar("name", { length: 180 }).notNull(),
    quantity: varchar("quantity", { length: 120 }),
    priority: mysqlEnum("priority", ["low", "medium", "high"])
      .default("medium")
      .notNull(),
    buyerId: int("buyerId").references(() => users.id),
    completed: boolean("completed").default(false).notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    familyCompleted: index("householdNeeds_family_completed_idx").on(
      table.familyId,
      table.completed
    ),
    buyer: index("householdNeeds_buyer_idx").on(table.buyerId),
  })
);

export const importantContacts = mysqlTable(
  "importantContacts",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId")
      .notNull()
      .references(() => families.id),
    kind: mysqlEnum("kind", [
      "provider",
      "clinic",
      "family",
      "emergency",
    ]).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    organization: varchar("organization", { length: 180 }),
    phone: varchar("phone", { length: 80 }),
    email: varchar("email", { length: 320 }),
    notes: varchar("notes", { length: 1000 }),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    familyKind: index("importantContacts_family_kind_idx").on(
      table.familyId,
      table.kind
    ),
  })
);

export const taskCollaborationRequests = mysqlTable(
  "taskCollaborationRequests",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId").notNull().references(() => families.id),
    taskId: int("taskId").notNull().references(() => careTasks.id),
    kind: mysqlEnum("kind", ["help", "swap"]).notNull(),
    requesterId: int("requesterId").notNull().references(() => users.id),
    targetId: int("targetId").notNull().references(() => users.id),
    status: mysqlEnum("status", ["pending", "accepted", "declined", "cancelled"])
      .default("pending").notNull(),
    taskSnapshot: json("taskSnapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    respondedAt: timestamp("respondedAt"),
  },
  table => ({
    familyStatus: index("taskCollaboration_family_status_idx").on(table.familyId, table.status),
    taskStatus: index("taskCollaboration_task_status_idx").on(table.taskId, table.status),
    targetStatus: index("taskCollaboration_target_status_idx").on(table.targetId, table.status),
  })
);

export const careAbsences = mysqlTable(
  "careAbsences",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId").notNull().references(() => families.id),
    memberId: int("memberId").notNull().references(() => users.id),
    createdBy: int("createdBy").notNull().references(() => users.id),
    startDate: varchar("startDate", { length: 10 }).notNull(),
    endDate: varchar("endDate", { length: 10 }).notNull(),
    note: varchar("note", { length: 1000 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    familyDates: index("careAbsences_family_dates_idx").on(table.familyId, table.startDate, table.endDate),
    memberDates: index("careAbsences_member_dates_idx").on(table.memberId, table.startDate, table.endDate),
  })
);

export const careAuditLog = mysqlTable(
  "careAuditLog",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId").notNull().references(() => families.id),
    actorId: int("actorId").notNull().references(() => users.id),
    action: varchar("action", { length: 48 }).notNull(),
    resourceType: varchar("resourceType", { length: 24 }).notNull(),
    resourceId: int("resourceId"),
    previousValues: json("previousValues").$type<Record<string, unknown> | null>(),
    newValues: json("newValues").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ familyCreated: index("careAuditLog_family_created_idx").on(table.familyId, table.createdAt) })
);

export const careHandoffs = mysqlTable(
  "careHandoffs",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId").notNull().references(() => families.id),
    eventId: int("eventId").notNull().references(() => careEvents.id),
    fromUserId: int("fromUserId").notNull().references(() => users.id),
    recipientId: int("recipientId").notNull().references(() => users.id),
    context: text("context").notNull(),
    pendingTaskIds: json("pendingTaskIds").$type<number[]>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ familyCreated: index("careHandoffs_family_created_idx").on(table.familyId, table.createdAt), recipient: index("careHandoffs_recipient_idx").on(table.recipientId, table.createdAt) })
);

export const careDigestPreferences = mysqlTable(
  "careDigestPreferences",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId").notNull().references(() => families.id),
    userId: int("userId").notNull().references(() => users.id),
    enabled: boolean("enabled").default(false).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    familyUser: uniqueIndex("careDigestPreferences_family_user_uq").on(table.familyId, table.userId),
    userLookup: index("careDigestPreferences_user_idx").on(table.userId),
  })
);



export const notificationPreferences = mysqlTable(
  "notificationPreferences",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId").notNull().references(() => families.id),
    userId: int("userId").notNull().references(() => users.id),
    reminderOptIn: boolean("reminderOptIn").default(false).notNull(),
    escalationOptIn: boolean("escalationOptIn").default(false).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    familyUser: uniqueIndex("notificationPreferences_family_user_uq").on(table.familyId, table.userId),
    userLookup: index("notificationPreferences_user_idx").on(table.userId),
  })
);

/** Durable in-app events only. No mail/push transport is configured or invoked. */
export const notificationEvents = mysqlTable(
  "notificationEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    eventKey: varchar("eventKey", { length: 255 }).notNull().unique(),
    familyId: int("familyId").notNull().references(() => families.id),
    medicationId: int("medicationId").notNull().references(() => medications.id),
    doseDate: varchar("doseDate", { length: 10 }).notNull(),
    doseTime: varchar("doseTime", { length: 5 }).notNull(),
    recipientId: int("recipientId").notNull().references(() => users.id),
    kind: mysqlEnum("kind", ["due_reminder", "unconfirmed_10m", "escalation_20m"]).notNull(),
    message: varchar("message", { length: 255 }).notNull(),
    scheduledAt: timestamp("scheduledAt").notNull(),
    status: mysqlEnum("status", ["created", "read", "cancelled"]).default("created").notNull(),
    emailDeliveryStatus: mysqlEnum("emailDeliveryStatus", ["not_configured"]).default("not_configured").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    readAt: timestamp("readAt"),
  },
  table => ({
    inbox: index("notificationEvents_recipient_status_idx").on(table.familyId, table.recipientId, table.status, table.createdAt),
    dose: index("notificationEvents_dose_idx").on(table.familyId, table.medicationId, table.doseDate, table.doseTime),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
