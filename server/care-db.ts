import { createHash, randomBytes } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  canConfirmDoseAt,
  dateKeyInZone,
  isValidTimeZone,
  resolveLocalDateTime,
  scheduledDoseInstant,
} from "../shared/timezone";
import {
  nextRecurringDueDate,
  normalizeDoseTimes,
  storedDoseTimes,
} from "./care-utils";
import {
  careEvents,
  careAbsences,
  careAuditLog,
  careHandoffs,
  careDigestPreferences,
  notificationPreferences,
  notificationEvents,
  careNotes,
  careTaskCompletions,
  careTasks,
  doseConfirmations,
  families,
  familyInvitations,
  familyMembers,
  householdNeeds,
  importantContacts,
  medications,
  taskCollaborationRequests,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { planDoseNotifications } from "./notification-scheduler";

export type FamilyRole = "owner" | "coordinator" | "caregiver" | "viewer";
const managers: FamilyRole[] = ["owner", "coordinator"];

async function recordAudit(
  tx: any,
  input: {
    familyId: number;
    actorId: number;
    action: string;
    resourceType: string;
    resourceId?: number | null;
    previousValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
  }
) {
  await tx.insert(careAuditLog).values(input);
}

export async function requireMembership(userId: number, familyId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Family data is temporarily unavailable.",
    });
  const [member] = await db
    .select({ role: familyMembers.role })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.familyId, familyId),
        eq(familyMembers.userId, userId)
      )
    )
    .limit(1);
  if (!member)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this family.",
    });
  return member.role as FamilyRole;
}

export function requireWrite(role: FamilyRole) {
  if (role === "viewer")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This family role is view-only.",
    });
}

export function requireManager(role: FamilyRole) {
  if (!managers.includes(role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a family owner or coordinator can do that.",
    });
}

async function requireAssigneeInFamily(
  userId: number | null | undefined,
  familyId: number
) {
  if (userId == null) return;
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Family data is temporarily unavailable.",
    });
  const [member] = await db
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.familyId, familyId),
        eq(familyMembers.userId, userId)
      )
    )
    .limit(1);
  if (!member)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a current family member.",
    });
}

export async function listFamilies(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Family data is temporarily unavailable.",
    });
  return db
    .select({
      id: families.id,
      name: families.name,
      role: familyMembers.role,
      createdAt: families.createdAt,
    })
    .from(familyMembers)
    .innerJoin(families, eq(familyMembers.familyId, families.id))
    .where(eq(familyMembers.userId, userId))
    .orderBy(asc(families.name));
}

export async function createFamily(userId: number, name: string) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Family data is temporarily unavailable.",
    });
  return db.transaction(async tx => {
    const [result] = await tx
      .insert(families)
      .values({ name: name.trim(), createdBy: userId });
    const familyId = Number(
      (result as { insertId?: number | bigint }).insertId
    );
    if (!familyId)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The family could not be created.",
      });
    await tx.insert(familyMembers).values({ familyId, userId, role: "owner" });
    return { id: familyId, name: name.trim(), role: "owner" as const };
  });
}

export async function listMembers(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db
    .select({
      id: familyMembers.id,
      userId: familyMembers.userId,
      name: users.name,
      email: users.email,
      role: familyMembers.role,
      joinedAt: familyMembers.joinedAt,
    })
    .from(familyMembers)
    .innerJoin(users, eq(familyMembers.userId, users.id))
    .where(eq(familyMembers.familyId, familyId))
    .orderBy(asc(familyMembers.joinedAt));
}

export async function exportFamily(userId: number, familyId: number) {
  const role = await requireMembership(userId, familyId);
  requireManager(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [family] = await db
    .select({
      id: families.id,
      name: families.name,
      createdAt: families.createdAt,
    })
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  if (!family) throw new TRPCError({ code: "NOT_FOUND" });
  const [
    members,
    tasks,
    taskCompletions,
    medicationRows,
    doseConfirmationsRows,
    events,
    careJournal,
    householdNeedsRows,
    contacts,
    invitations,
    collaborationRequests,
    absences,
    auditHistory,
    handoffs,
    notificationPrefs,
    notificationHistory,
  ] = await Promise.all([
    db
      .select({
        id: familyMembers.id,
        userId: familyMembers.userId,
        name: users.name,
        email: users.email,
        role: familyMembers.role,
        joinedAt: familyMembers.joinedAt,
      })
      .from(familyMembers)
      .innerJoin(users, eq(familyMembers.userId, users.id))
      .where(eq(familyMembers.familyId, familyId))
      .orderBy(asc(familyMembers.joinedAt)),
    db
      .select()
      .from(careTasks)
      .where(eq(careTasks.familyId, familyId))
      .orderBy(asc(careTasks.createdAt)),
    db
      .select({
        id: careTaskCompletions.id,
        taskId: careTaskCompletions.taskId,
        completedBy: careTaskCompletions.completedBy,
        completedByName: users.name,
        completedAt: careTaskCompletions.completedAt,
      })
      .from(careTaskCompletions)
      .leftJoin(users, eq(careTaskCompletions.completedBy, users.id))
      .where(eq(careTaskCompletions.familyId, familyId))
      .orderBy(asc(careTaskCompletions.completedAt)),
    db
      .select()
      .from(medications)
      .where(eq(medications.familyId, familyId))
      .orderBy(asc(medications.createdAt)),
    db
      .select()
      .from(doseConfirmations)
      .where(eq(doseConfirmations.familyId, familyId))
      .orderBy(asc(doseConfirmations.confirmedAt)),
    db
      .select()
      .from(careEvents)
      .where(eq(careEvents.familyId, familyId))
      .orderBy(asc(careEvents.startsAt)),
    db
      .select()
      .from(careNotes)
      .where(eq(careNotes.familyId, familyId))
      .orderBy(asc(careNotes.createdAt)),
    db
      .select()
      .from(householdNeeds)
      .where(eq(householdNeeds.familyId, familyId))
      .orderBy(asc(householdNeeds.createdAt)),
    db
      .select()
      .from(importantContacts)
      .where(eq(importantContacts.familyId, familyId))
      .orderBy(asc(importantContacts.kind), asc(importantContacts.name)),
    db
      .select({
        id: familyInvitations.id,
        email: familyInvitations.email,
        role: familyInvitations.role,
        status: familyInvitations.status,
        invitedBy: familyInvitations.invitedBy,
        acceptedBy: familyInvitations.acceptedBy,
        createdAt: familyInvitations.createdAt,
        expiresAt: familyInvitations.expiresAt,
      })
      .from(familyInvitations)
      .where(eq(familyInvitations.familyId, familyId))
      .orderBy(asc(familyInvitations.createdAt)),
    db
      .select()
      .from(taskCollaborationRequests)
      .where(eq(taskCollaborationRequests.familyId, familyId))
      .orderBy(asc(taskCollaborationRequests.createdAt)),
    db
      .select()
      .from(careAbsences)
      .where(eq(careAbsences.familyId, familyId))
      .orderBy(asc(careAbsences.startDate)),
    db
      .select()
      .from(careAuditLog)
      .where(eq(careAuditLog.familyId, familyId))
      .orderBy(asc(careAuditLog.createdAt)),
    db
      .select()
      .from(careHandoffs)
      .where(eq(careHandoffs.familyId, familyId))
      .orderBy(asc(careHandoffs.createdAt)),
    db.select().from(notificationPreferences).where(eq(notificationPreferences.familyId, familyId)).orderBy(asc(notificationPreferences.userId)),
    db.select().from(notificationEvents).where(eq(notificationEvents.familyId, familyId)).orderBy(asc(notificationEvents.createdAt)),
  ]);
  const digestPreferences = await db.select().from(careDigestPreferences)
    .where(eq(careDigestPreferences.familyId, familyId))
    .orderBy(asc(careDigestPreferences.userId));
  return {
    exportedAt: new Date().toISOString(),
    family,
    members,
    tasks,
    taskCompletions,
    medications: medicationRows,
    doseConfirmations: doseConfirmationsRows,
    events,
    careJournal,
    householdNeeds: householdNeedsRows,
    importantContacts: contacts,
    invitations,
    collaborationRequests,
    absences,
    auditHistory,
    handoffs,
    digestPreferences,
    notificationPreferences: notificationPrefs,
    notificationEvents: notificationHistory,
  };
}

function reportBounds(startDate: string, endDate: string) {
  return { start: new Date(`${startDate}T00:00:00.000Z`), end: new Date(`${endDate}T23:59:59.999Z`) };
}

export async function getWorkloadReport(userId: number, familyId: number, startDate: string, endDate: string) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const { start, end } = reportBounds(startDate, endDate);
  const tasks = await db.select({ id: careTasks.id, familyId: careTasks.familyId, title: careTasks.title, assigneeId: careTasks.assigneeId, status: careTasks.status, dueAt: careTasks.dueAt, completedAt: careTasks.completedAt, estimatedMinutes: careTasks.estimatedMinutes }).from(careTasks).where(and(eq(careTasks.familyId, familyId), or(and(gte(careTasks.dueAt, start), lte(careTasks.dueAt, end)), and(gte(careTasks.completedAt, start), lte(careTasks.completedAt, end)))));
  const people = await db.select({ userId: familyMembers.userId, name: users.name }).from(familyMembers).innerJoin(users, eq(familyMembers.userId, users.id)).where(eq(familyMembers.familyId, familyId));
  const now = new Date();
  const buckets = new Map<number | null, { userId: number | null; name: string; completed: number; upcoming: number; overdue: number; estimatedMinutesTotal: number | null }>();
  for (const person of people) buckets.set(person.userId, { userId: person.userId, name: person.name || "Family member", completed: 0, upcoming: 0, overdue: 0, estimatedMinutesTotal: 0 });
  buckets.set(null, { userId: null, name: "Unassigned", completed: 0, upcoming: 0, overdue: 0, estimatedMinutesTotal: 0 });
  for (const task of tasks) {
    const bucket = buckets.get(task.assigneeId) ?? buckets.get(null)!;
    if (task.status === "completed" && task.completedAt && task.completedAt >= start && task.completedAt <= end) bucket.completed++;
    else if (task.status !== "completed" && task.dueAt && task.dueAt >= start && task.dueAt <= end) {
      if (task.dueAt < now) bucket.overdue++;
      else bucket.upcoming++;
    }
    if (task.estimatedMinutes != null) bucket.estimatedMinutesTotal = (bucket.estimatedMinutesTotal ?? 0) + task.estimatedMinutes;
  }
  return { familyId, startDate, endDate, members: [...buckets.values()], caveat: "Counts and optional estimates support a family conversation; they do not measure fairness. Tasks differ in effort and circumstances. No one is scored, ranked, or judged." };
}

export async function getWeeklySummary(userId: number, familyId: number, startDate: string, endDate: string) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const { start, end } = reportBounds(startDate, endDate);
  const [tasks, events, requests] = await Promise.all([
    db.select({ id: careTasks.id, status: careTasks.status, dueAt: careTasks.dueAt, completedAt: careTasks.completedAt, assigneeId: careTasks.assigneeId }).from(careTasks).where(and(eq(careTasks.familyId, familyId), or(and(gte(careTasks.dueAt, start), lte(careTasks.dueAt, end)), and(gte(careTasks.completedAt, start), lte(careTasks.completedAt, end))))),
    db.select({ id: careEvents.id, title: careEvents.title, kind: careEvents.kind, startsAt: careEvents.startsAt }).from(careEvents).where(and(eq(careEvents.familyId, familyId), gte(careEvents.startsAt, start), lte(careEvents.startsAt, end))).orderBy(asc(careEvents.startsAt)),
    db.select({ id: taskCollaborationRequests.id }).from(taskCollaborationRequests).where(and(eq(taskCollaborationRequests.familyId, familyId), eq(taskCollaborationRequests.status, "pending"), gte(taskCollaborationRequests.createdAt, start), lte(taskCollaborationRequests.createdAt, end))),
  ]);
  const inRange = (date: Date | null) => !!date && date >= start && date <= end;
  return { familyId, startDate, endDate,
    completedTasks: tasks.filter(row => row.status === "completed" && inRange(row.completedAt)).length,
    pendingTasks: tasks.filter(row => row.status !== "completed" && inRange(row.dueAt)).length,
    events: events.map(({ title, kind, startsAt }) => ({ title, kind, startsAt })),
    unassignedTasks: tasks.filter(row => row.status !== "completed" && row.assigneeId == null && (inRange(row.dueAt) || !row.dueAt)).length,
    pendingHelpRequests: requests.length,
    privacy: "Counts and event titles only. Care notes, medication details, and task notes are excluded by default." };
}

export async function getDigestPreference(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [row] = await db.select({ enabled: careDigestPreferences.enabled }).from(careDigestPreferences).where(and(eq(careDigestPreferences.familyId, familyId), eq(careDigestPreferences.userId, userId))).limit(1);
  return { familyId, enabled: row?.enabled ?? false, kind: "preference_only" as const, deliveryConfigured: false };
}

export async function setDigestPreference(userId: number, familyId: number, enabled: boolean) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [row] = await db.select({ id: careDigestPreferences.id }).from(careDigestPreferences).where(and(eq(careDigestPreferences.familyId, familyId), eq(careDigestPreferences.userId, userId))).limit(1);
  if (row) await db.update(careDigestPreferences).set({ enabled }).where(and(eq(careDigestPreferences.familyId, familyId), eq(careDigestPreferences.userId, userId)));
  else await db.insert(careDigestPreferences).values({ familyId, userId, enabled });
  return { familyId, enabled, kind: "preference_only" as const, deliveryConfigured: false, message: "Saved preference only; email delivery and scheduling are not configured." };
}

export async function getNotificationPreferences(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [row] = await db.select({ reminderOptIn: notificationPreferences.reminderOptIn, escalationOptIn: notificationPreferences.escalationOptIn }).from(notificationPreferences).where(and(eq(notificationPreferences.familyId, familyId), eq(notificationPreferences.userId, userId))).limit(1);
  return { familyId, reminderOptIn: row?.reminderOptIn ?? false, escalationOptIn: row?.escalationOptIn ?? false, emailDeliveryConfigured: false, deliveryMode: "in_app_only" as const };
}

export async function setNotificationPreferences(userId: number, familyId: number, reminderOptIn: boolean, escalationOptIn: boolean) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [row] = await db.select({ id: notificationPreferences.id }).from(notificationPreferences).where(and(eq(notificationPreferences.familyId, familyId), eq(notificationPreferences.userId, userId))).limit(1);
  if (row) await db.update(notificationPreferences).set({ reminderOptIn, escalationOptIn }).where(and(eq(notificationPreferences.familyId, familyId), eq(notificationPreferences.userId, userId)));
  else await db.insert(notificationPreferences).values({ familyId, userId, reminderOptIn, escalationOptIn });
  const revokedKinds = [!reminderOptIn ? or(eq(notificationEvents.kind, "due_reminder"), eq(notificationEvents.kind, "unconfirmed_10m")) : undefined, !escalationOptIn ? eq(notificationEvents.kind, "escalation_20m") : undefined].filter(Boolean);
  if (revokedKinds.length) await db.update(notificationEvents).set({ status: "cancelled" }).where(and(eq(notificationEvents.familyId, familyId), eq(notificationEvents.recipientId, userId), eq(notificationEvents.status, "created"), or(...revokedKinds as any[])));
  return { familyId, reminderOptIn, escalationOptIn, emailDeliveryConfigured: false, message: "Saved consent for in-app notifications only. Email delivery is not configured; nothing is sent outside this app." };
}

export async function listInAppNotifications(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.select({ id: notificationEvents.id, medicationId: notificationEvents.medicationId, doseDate: notificationEvents.doseDate, doseTime: notificationEvents.doseTime, kind: notificationEvents.kind, message: notificationEvents.message, scheduledAt: notificationEvents.scheduledAt, status: notificationEvents.status, emailDeliveryStatus: notificationEvents.emailDeliveryStatus, createdAt: notificationEvents.createdAt, readAt: notificationEvents.readAt }).from(notificationEvents).where(and(eq(notificationEvents.familyId, familyId), eq(notificationEvents.recipientId, userId), or(eq(notificationEvents.status, "created"), eq(notificationEvents.status, "read")))).orderBy(desc(notificationEvents.createdAt)).limit(100);
}

export async function markInAppNotificationRead(userId: number, familyId: number, notificationId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const result = await db.update(notificationEvents).set({ status: "read", readAt: new Date() }).where(and(eq(notificationEvents.id, notificationId), eq(notificationEvents.familyId, familyId), eq(notificationEvents.recipientId, userId), eq(notificationEvents.status, "created")));
  return { success: true };
}

export async function getPlanStatus(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  return { familyId, plan: "free" as const, premiumAvailable: false, entitlements: { coreCare: true, safetyFeatures: true, familyDataAccess: true }, billingConfigured: false, message: "Free plan metadata only. Premium is not available; no pricing, signup, or payment is configured." };
}

function invitationDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(
  userId: number,
  familyId: number,
  email: string | null,
  role: "coordinator" | "caregiver" | "viewer"
) {
  const memberRole = await requireMembership(userId, familyId);
  requireManager(memberRole);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(familyInvitations).values({
    familyId,
    email: email?.trim().toLowerCase() || null,
    role,
    tokenHash: invitationDigest(token),
    invitedBy: userId,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function previewInvitation(token: string) {
  const db = await getDb();
  if (!db || token.length < 32 || token.length > 128) return null;
  const [invite] = await db
    .select({
      id: familyInvitations.id,
      familyId: familyInvitations.familyId,
      email: familyInvitations.email,
      role: familyInvitations.role,
      status: familyInvitations.status,
      expiresAt: familyInvitations.expiresAt,
      familyName: families.name,
    })
    .from(familyInvitations)
    .innerJoin(families, eq(familyInvitations.familyId, families.id))
    .where(
      and(
        eq(familyInvitations.tokenHash, invitationDigest(token)),
        eq(familyInvitations.status, "pending"),
        gt(familyInvitations.expiresAt, new Date())
      )
    )
    .limit(1);
  return invite ?? null;
}

export async function listInvitations(userId: number, familyId: number) {
  const role = await requireMembership(userId, familyId);
  requireManager(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db
    .select({
      id: familyInvitations.id,
      email: familyInvitations.email,
      role: familyInvitations.role,
      status: familyInvitations.status,
      expiresAt: familyInvitations.expiresAt,
      createdAt: familyInvitations.createdAt,
    })
    .from(familyInvitations)
    .where(eq(familyInvitations.familyId, familyId))
    .orderBy(desc(familyInvitations.createdAt))
    .limit(50);
}

export async function respondToInvitation(
  userId: number,
  email: string | null,
  token: string,
  accept: boolean
) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [invite] = await tx
      .select({
        id: familyInvitations.id,
        familyId: familyInvitations.familyId,
        email: familyInvitations.email,
        role: familyInvitations.role,
        familyName: families.name,
      })
      .from(familyInvitations)
      .innerJoin(families, eq(familyInvitations.familyId, families.id))
      .where(
        and(
          eq(familyInvitations.tokenHash, invitationDigest(token)),
          eq(familyInvitations.status, "pending"),
          gt(familyInvitations.expiresAt, new Date())
        )
      )
      .limit(1)
      .for("update");
    if (!invite)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This invitation is unavailable or has expired.",
      });
    if (
      invite.email &&
      invite.email.toLowerCase() !== (email ?? "").toLowerCase()
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sign in with the email address this invitation was sent to.",
      });
    }
    if (accept) {
      const [existing] = await tx
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, invite.familyId),
            eq(familyMembers.userId, userId)
          )
        )
        .limit(1);
      if (!existing)
        await tx
          .insert(familyMembers)
          .values({ familyId: invite.familyId, userId, role: invite.role });
    }
    await tx
      .update(familyInvitations)
      .set({
        status: accept ? "accepted" : "declined",
        acceptedBy: accept ? userId : null,
      })
      .where(
        and(
          eq(familyInvitations.id, invite.id),
          eq(familyInvitations.status, "pending")
        )
      );
    return {
      familyId: invite.familyId,
      familyName: invite.familyName,
      accepted: accept,
    };
  });
}

export async function revokeInvitation(
  userId: number,
  familyId: number,
  invitationId: number
) {
  const role = await requireMembership(userId, familyId);
  requireManager(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  await db
    .update(familyInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(familyInvitations.id, invitationId),
        eq(familyInvitations.familyId, familyId),
        eq(familyInvitations.status, "pending")
      )
    );
  return { success: true };
}

export async function changeMemberRole(
  userId: number,
  familyId: number,
  memberId: number,
  nextRole: "coordinator" | "caregiver" | "viewer"
) {
  const role = await requireMembership(userId, familyId);
  requireManager(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [target] = await tx
      .select({ id: familyMembers.id, role: familyMembers.role, userId: familyMembers.userId })
      .from(familyMembers)
      .where(and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, familyId)))
      .limit(1)
      .for("update");
    if (!target) throw new TRPCError({ code: "NOT_FOUND" });
    if (target.role === "owner")
      throw new TRPCError({ code: "FORBIDDEN", message: "The family owner role cannot be changed here." });
    if (target.role !== nextRole) {
      await tx.update(familyMembers).set({ role: nextRole }).where(and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, familyId)));
      await recordAudit(tx, { familyId, actorId: userId, action: "role.changed", resourceType: "member", resourceId: target.userId, previousValues: { role: target.role }, newValues: { role: nextRole } });
    }
    return { success: true };
  });
}

export async function transferOwnership(
  userId: number,
  familyId: number,
  memberId: number
) {
  const currentRole = await requireMembership(userId, familyId);
  if (currentRole !== "owner")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the current family owner can transfer ownership.",
    });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });

  return db.transaction(async tx => {
    const [owner] = await tx
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, userId)
        )
      )
      .limit(1)
      .for("update");
    if (!owner || owner.role !== "owner")
      throw new TRPCError({ code: "CONFLICT" });

    const [target] = await tx
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.id, memberId),
          eq(familyMembers.familyId, familyId)
        )
      )
      .limit(1)
      .for("update");
    if (!target) throw new TRPCError({ code: "NOT_FOUND" });
    if (target.role === "owner")
      throw new TRPCError({
        code: "CONFLICT",
        message: "This family already has an owner.",
      });

    await tx
      .update(familyMembers)
      .set({ role: "coordinator" })
      .where(
        and(
          eq(familyMembers.id, owner.id),
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.role, "owner")
        )
      );
    await tx
      .update(familyMembers)
      .set({ role: "owner" })
      .where(
        and(
          eq(familyMembers.id, target.id),
          eq(familyMembers.familyId, familyId)
        )
      );
    return { success: true };
  });
}

export async function removeMember(
  userId: number,
  familyId: number,
  memberId: number
) {
  const role = await requireMembership(userId, familyId);
  requireManager(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [target] = await db
    .select({ id: familyMembers.id, role: familyMembers.role, userId: familyMembers.userId })
    .from(familyMembers)
    .where(
      and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, familyId))
    )
    .limit(1);
  if (!target) throw new TRPCError({ code: "NOT_FOUND" });
  if (target.role === "owner")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The family owner cannot be removed.",
    });
  await db.update(medications).set({ escalationRecipientId: null }).where(and(eq(medications.familyId, familyId), eq(medications.escalationRecipientId, target.userId)));
  await db.update(notificationEvents).set({ status: "cancelled" }).where(and(eq(notificationEvents.familyId, familyId), eq(notificationEvents.recipientId, target.userId), eq(notificationEvents.status, "created")));
  await db.delete(notificationPreferences).where(and(eq(notificationPreferences.familyId, familyId), eq(notificationPreferences.userId, target.userId)));
  await db
    .delete(familyMembers)
    .where(
      and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, familyId))
    );
  return { success: true };
}

export async function leaveFamily(userId: number, familyId: number) {
  const role = await requireMembership(userId, familyId);
  if (role === "owner")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The owner must transfer ownership before leaving.",
    });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  await db.update(medications).set({ escalationRecipientId: null }).where(and(eq(medications.familyId, familyId), eq(medications.escalationRecipientId, userId)));
  await db.update(notificationEvents).set({ status: "cancelled" }).where(and(eq(notificationEvents.familyId, familyId), eq(notificationEvents.recipientId, userId), eq(notificationEvents.status, "created")));
  await db.delete(notificationPreferences).where(and(eq(notificationPreferences.familyId, familyId), eq(notificationPreferences.userId, userId)));
  await db
    .delete(familyMembers)
    .where(
      and(
        eq(familyMembers.familyId, familyId),
        eq(familyMembers.userId, userId)
      )
    );
  return { success: true };
}

/** Remove the login/profile and memberships while retaining shared family history
 * under a non-loginable, generic former-member record. Owners must transfer all
 * family ownership before this destructive account operation is permitted.
 */
export async function deleteAccount(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [user] = await tx
      .select({ id: users.id, openId: users.openId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    const memberships = await tx
      .select({ familyId: familyMembers.familyId, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.userId, userId))
      .for("update");
    if (memberships.some(member => member.role === "owner"))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Transfer ownership of every family you own before deleting this account.",
      });

    const [tombstoneResult] = await tx.insert(users).values({
      openId: `former-${randomBytes(24).toString("hex")}`,
      name: "Former family member",
      email: null,
      loginMethod: null,
      role: "user",
    });
    const formerMemberId = Number(
      (tombstoneResult as { insertId?: number | bigint }).insertId
    );
    if (!formerMemberId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await tx
      .update(familyInvitations)
      .set({ status: "revoked" })
      .where(
        and(
          eq(familyInvitations.invitedBy, userId),
          eq(familyInvitations.status, "pending")
        )
      );
    await tx
      .update(familyInvitations)
      .set({ invitedBy: formerMemberId })
      .where(eq(familyInvitations.invitedBy, userId));
    await tx
      .update(familyInvitations)
      .set({ acceptedBy: formerMemberId })
      .where(eq(familyInvitations.acceptedBy, userId));
    await tx
      .update(families)
      .set({ createdBy: formerMemberId })
      .where(eq(families.createdBy, userId));
    await tx
      .update(careTasks)
      .set({ createdBy: formerMemberId })
      .where(eq(careTasks.createdBy, userId));
    await tx
      .update(careTasks)
      .set({ completedBy: formerMemberId })
      .where(eq(careTasks.completedBy, userId));
    await tx
      .update(careTaskCompletions)
      .set({ completedBy: formerMemberId })
      .where(eq(careTaskCompletions.completedBy, userId));
    await tx
      .update(medications)
      .set({ createdBy: formerMemberId })
      .where(eq(medications.createdBy, userId));
    await tx
      .update(doseConfirmations)
      .set({ confirmedBy: formerMemberId })
      .where(eq(doseConfirmations.confirmedBy, userId));
    await tx
      .update(careEvents)
      .set({ createdBy: formerMemberId })
      .where(eq(careEvents.createdBy, userId));
    await tx
      .update(careNotes)
      .set({ createdBy: formerMemberId })
      .where(eq(careNotes.createdBy, userId));
    await tx
      .update(householdNeeds)
      .set({ createdBy: formerMemberId })
      .where(eq(householdNeeds.createdBy, userId));
    await tx
      .update(importantContacts)
      .set({ createdBy: formerMemberId })
      .where(eq(importantContacts.createdBy, userId));
    await tx
      .update(careTasks)
      .set({ assigneeId: null })
      .where(eq(careTasks.assigneeId, userId));
    await tx
      .update(medications)
      .set({ assigneeId: null, escalationRecipientId: null })
      .where(or(eq(medications.assigneeId, userId), eq(medications.escalationRecipientId, userId)));
    await tx
      .update(careEvents)
      .set({ escortId: null })
      .where(eq(careEvents.escortId, userId));
    await tx.update(taskCollaborationRequests).set({ requesterId: formerMemberId }).where(eq(taskCollaborationRequests.requesterId, userId));
    await tx.update(taskCollaborationRequests).set({ targetId: formerMemberId }).where(eq(taskCollaborationRequests.targetId, userId));
    await tx.update(careAbsences).set({ memberId: formerMemberId }).where(eq(careAbsences.memberId, userId));
    await tx.update(careAbsences).set({ createdBy: formerMemberId }).where(eq(careAbsences.createdBy, userId));
    await tx.update(careAuditLog).set({ actorId: formerMemberId }).where(eq(careAuditLog.actorId, userId));
    await tx.update(careHandoffs).set({ fromUserId: formerMemberId }).where(eq(careHandoffs.fromUserId, userId));
    await tx.update(careHandoffs).set({ recipientId: formerMemberId }).where(eq(careHandoffs.recipientId, userId));
    await tx
      .update(householdNeeds)
      .set({ buyerId: null })
      .where(eq(householdNeeds.buyerId, userId));
    await tx.update(notificationEvents).set({ recipientId: formerMemberId, status: "cancelled" }).where(eq(notificationEvents.recipientId, userId));
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    await tx.delete(careDigestPreferences).where(eq(careDigestPreferences.userId, userId));
    await tx.delete(familyMembers).where(eq(familyMembers.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
    return { success: true, sharedHistoryRetained: true } as const;
  });
}

export async function listTasks(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const rows = await db
    .select({
      id: careTasks.id,
      familyId: careTasks.familyId,
      title: careTasks.title,
      description: careTasks.description,
      dueAt: careTasks.dueAt,
      priority: careTasks.priority,
      assigneeId: careTasks.assigneeId,
      status: careTasks.status,
      recurrence: careTasks.recurrence,
      notes: careTasks.notes,
      estimatedMinutes: careTasks.estimatedMinutes,
      createdBy: careTasks.createdBy,
      completedBy: careTasks.completedBy,
      completedAt: careTasks.completedAt,
      createdAt: careTasks.createdAt,
      updatedAt: careTasks.updatedAt,
      assigneeName: users.name,
    })
    .from(careTasks)
    .leftJoin(users, eq(careTasks.assigneeId, users.id))
    .where(eq(careTasks.familyId, familyId))
    .orderBy(asc(careTasks.dueAt), desc(careTasks.createdAt))
    .limit(200);
  const completerIds = [
    ...new Set(rows.flatMap(row => (row.completedBy ? [row.completedBy] : []))),
  ];
  const completers = completerIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, completerIds))
    : [];
  const completerNames = new Map(
    completers.map(person => [person.id, person.name])
  );
  const completionRows = rows.length
    ? await db
        .select({
          taskId: careTaskCompletions.taskId,
          completedAt: careTaskCompletions.completedAt,
          completedByName: users.name,
        })
        .from(careTaskCompletions)
        .innerJoin(users, eq(careTaskCompletions.completedBy, users.id))
        .where(
          and(
            eq(careTaskCompletions.familyId, familyId),
            inArray(
              careTaskCompletions.taskId,
              rows.map(row => row.id)
            )
          )
        )
        .orderBy(desc(careTaskCompletions.completedAt))
    : [];
  const completionHistory = new Map<
    number,
    Array<{ completedAt: Date; completedByName: string | null }>
  >();
  for (const completion of completionRows) {
    const history = completionHistory.get(completion.taskId) ?? [];
    history.push({
      completedAt: completion.completedAt,
      completedByName: completion.completedByName,
    });
    completionHistory.set(completion.taskId, history);
  }
  return rows.map(row => ({
    ...row,
    completedByName: row.completedBy
      ? (completerNames.get(row.completedBy) ?? null)
      : null,
    completionHistory: completionHistory.get(row.id) ?? [],
  }));
}

export async function createTask(
  userId: number,
  familyId: number,
  input: {
    title: string;
    description?: string | null;
    dueAt?: Date | null;
    priority: "low" | "medium" | "high";
    assigneeId?: number | null;
    recurrence: "none" | "daily" | "weekly" | "monthly";
    notes?: string | null;
    estimatedMinutes?: number | null;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  if (input.recurrence !== "none" && !input.dueAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Set a due date before repeating a task.",
    });
  await requireAssigneeInFamily(input.assigneeId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [result] = await db.insert(careTasks).values({
    ...input,
    familyId,
    title: input.title.trim(),
    createdBy: userId,
    status: "new",
  });
  await db.insert(careAuditLog).values({ familyId, actorId: userId, action: "task.created", resourceType: "task", resourceId: Number((result as { insertId?: number | bigint }).insertId), previousValues: null, newValues: { title: input.title.trim(), assigneeId: input.assigneeId ?? null, status: "new" } });
  return { success: true };
}

export async function updateTask(
  userId: number,
  familyId: number,
  taskId: number,
  input: {
    title: string;
    description?: string | null;
    dueAt?: Date | null;
    priority: "low" | "medium" | "high";
    assigneeId?: number | null;
    status: "new" | "in_progress" | "completed";
    recurrence: "none" | "daily" | "weekly" | "monthly";
    notes?: string | null;
    estimatedMinutes?: number | null;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  await requireAssigneeInFamily(input.assigneeId, familyId);
  await db.transaction(async tx => {
    const [lockedTask] = await tx
      .select()
      .from(careTasks)
      .where(and(eq(careTasks.id, taskId), eq(careTasks.familyId, familyId)))
      .limit(1)
      .for("update");
    if (!lockedTask) throw new TRPCError({ code: "NOT_FOUND" });
    if (
      !managers.includes(role) &&
      lockedTask.createdBy !== userId &&
      lockedTask.assigneeId !== userId
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    if (
      !managers.includes(role) &&
      input.assigneeId !== undefined &&
      input.assigneeId !== lockedTask.assigneeId
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only a coordinator can reassign this task.",
      });

    const repeatFrom =
      input.dueAt === undefined ? lockedTask.dueAt : input.dueAt;
    if (input.recurrence !== "none" && !repeatFrom) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Set a due date before repeating a task.",
      });
    }

    const newCompletion =
      input.status === "completed" && lockedTask.status !== "completed";
    const completedAt = new Date();
    const oldAuditValues = { title: lockedTask.title, description: lockedTask.description, dueAt: lockedTask.dueAt, priority: lockedTask.priority, assigneeId: lockedTask.assigneeId, status: lockedTask.status, recurrence: lockedTask.recurrence, notes: lockedTask.notes, estimatedMinutes: lockedTask.estimatedMinutes };
    const nextAuditValues = { title: input.title.trim(), description: input.description === undefined ? lockedTask.description : input.description, dueAt: repeatFrom, priority: input.priority, assigneeId: input.assigneeId === undefined ? lockedTask.assigneeId : input.assigneeId, status: input.status, recurrence: input.recurrence, notes: input.notes === undefined ? lockedTask.notes : input.notes, estimatedMinutes: input.estimatedMinutes === undefined ? lockedTask.estimatedMinutes : input.estimatedMinutes };
    await tx
      .update(careTasks)
      .set({
        ...input,
        dueAt: repeatFrom,
        title: input.title.trim(),
        completedBy: newCompletion ? userId : lockedTask.completedBy,
        completedAt: newCompletion ? completedAt : lockedTask.completedAt,
      })
      .where(and(eq(careTasks.id, taskId), eq(careTasks.familyId, familyId)));

    await recordAudit(tx, { familyId, actorId: userId, action: newCompletion ? "task.completed" : "task.updated", resourceType: "task", resourceId: taskId, previousValues: oldAuditValues, newValues: nextAuditValues });

    if (newCompletion) {
      await tx.insert(careTaskCompletions).values({
        familyId,
        taskId,
        completedBy: userId,
        completedAt,
      });
    }

    if (
      input.status === "completed" &&
      input.recurrence !== "none" &&
      repeatFrom
    ) {
      const nextDueAt = nextRecurringDueDate(repeatFrom, input.recurrence);
      if (nextDueAt)
        await tx
          .insert(careTasks)
          .values({
            familyId,
            title: input.title.trim(),
            description:
              input.description === undefined
                ? lockedTask.description
                : input.description,
            dueAt: nextDueAt,
            priority: input.priority,
            assigneeId:
              input.assigneeId === undefined
                ? lockedTask.assigneeId
                : input.assigneeId,
            status: "new",
            recurrence: input.recurrence,
            notes: input.notes === undefined ? lockedTask.notes : input.notes,
            createdBy: userId,
            generatedFromTaskId: taskId,
          })
          .onDuplicateKeyUpdate({ set: { generatedFromTaskId: taskId } });
    }
  });
  return { success: true };
}

export async function deleteTask(
  userId: number,
  familyId: number,
  taskId: number
) {
  const role = await requireMembership(userId, familyId);
  requireManager(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [task] = await tx.select().from(careTasks).where(and(eq(careTasks.id, taskId), eq(careTasks.familyId, familyId))).limit(1).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    await tx.delete(careTasks).where(and(eq(careTasks.id, taskId), eq(careTasks.familyId, familyId)));
    await recordAudit(tx, { familyId, actorId: userId, action: "task.deleted", resourceType: "task", resourceId: taskId, previousValues: task, newValues: null });
    return { success: true };
  });
}

async function requireEscalationRecipientInFamily(userId: number | null | undefined, familyId: number) {
  if (userId == null) return;
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [row] = await db.select({ memberId: familyMembers.id, optedIn: notificationPreferences.escalationOptIn }).from(familyMembers).leftJoin(notificationPreferences, and(eq(notificationPreferences.familyId, familyMembers.familyId), eq(notificationPreferences.userId, familyMembers.userId))).where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId))).limit(1);
  if (!row?.memberId || row.optedIn !== true) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a current family member who has explicitly opted in to receive escalation alerts." });
}

/** Reconcile due instances into the durable in-app outbox; DB unique eventKey makes retries/restarts idempotent. This performs no network delivery. */
export async function reconcileDueDoseNotifications(now = new Date()) {
  const db = await getDb();
  if (!db || !Number.isFinite(now.getTime())) return { created: 0, checked: 0 };
  const meds = await db.select({ id: medications.id, familyId: medications.familyId, name: medications.name, doseTimes: medications.doseTimes, timeZone: medications.timeZone, startDate: medications.startDate, endDate: medications.endDate, assigneeId: medications.assigneeId, escalationRecipientId: medications.escalationRecipientId }).from(medications).where(eq(medications.active, true)).limit(1000);
  let created = 0, checked = 0;
  for (const med of meds) {
    const zone = isValidTimeZone(med.timeZone) ? med.timeZone : "UTC";
    const today = dateKeyInZone(now, zone);
    const dates = [today, new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)];
    for (const doseDate of dates) {
      if ((med.startDate && doseDate < med.startDate) || (med.endDate && doseDate > med.endDate)) continue;
      for (const doseTime of storedDoseTimes(med.doseTimes)) {
        const dueAt = doseTime === "once" ? null : scheduledDoseInstant(doseDate, doseTime, zone);
        if (!dueAt || dueAt.getTime() > now.getTime()) continue;
        checked++;
        await db.transaction(async tx => {
          // Confirmation takes the same medication-row lock. This closes the race where the worker
          // might insert a notification after confirmation's cancellation pass.
          const [locked] = await tx.select({ id: medications.id }).from(medications).where(and(eq(medications.id, med.id), eq(medications.familyId, med.familyId), eq(medications.active, true))).limit(1).for("update");
          if (!locked) return;
          const [confirmation] = await tx.select({ id: doseConfirmations.id }).from(doseConfirmations).where(and(eq(doseConfirmations.familyId, med.familyId), eq(doseConfirmations.medicationId, med.id), eq(doseConfirmations.doseDate, doseDate), eq(doseConfirmations.doseTime, doseTime))).limit(1);
          if (confirmation) {
            await tx.update(notificationEvents).set({ status: "cancelled" }).where(and(eq(notificationEvents.familyId, med.familyId), eq(notificationEvents.medicationId, med.id), eq(notificationEvents.doseDate, doseDate), eq(notificationEvents.doseTime, doseTime), or(eq(notificationEvents.status, "created"), eq(notificationEvents.status, "read"))));
            return;
          }
          const [assignee] = med.assigneeId ? await tx.select({ memberId: familyMembers.id, optedIn: notificationPreferences.reminderOptIn }).from(familyMembers).leftJoin(notificationPreferences, and(eq(notificationPreferences.familyId, familyMembers.familyId), eq(notificationPreferences.userId, familyMembers.userId))).where(and(eq(familyMembers.familyId, med.familyId), eq(familyMembers.userId, med.assigneeId))).limit(1) : [];
          const [escalationRecipient] = med.escalationRecipientId ? await tx.select({ memberId: familyMembers.id, optedIn: notificationPreferences.escalationOptIn }).from(familyMembers).leftJoin(notificationPreferences, and(eq(notificationPreferences.familyId, familyMembers.familyId), eq(notificationPreferences.userId, familyMembers.userId))).where(and(eq(familyMembers.familyId, med.familyId), eq(familyMembers.userId, med.escalationRecipientId))).limit(1) : [];
          const plans = planDoseNotifications({ medicationId: med.id, medicationName: med.name, doseDate, doseTime, timeZone: zone, now, assigneeId: med.assigneeId, assigneeIsCurrentMember: !!assignee?.memberId, assigneeReminderOptIn: assignee?.optedIn === true, escalationRecipientId: med.escalationRecipientId, escalationRecipientIsCurrentMember: !!escalationRecipient?.memberId, escalationRecipientOptIn: escalationRecipient?.optedIn === true, alreadyConfirmed: false });
          for (const event of plans) {
            await tx.insert(notificationEvents).values({ ...event, familyId: med.familyId, medicationId: med.id, emailDeliveryStatus: "not_configured" }).onDuplicateKeyUpdate({ set: { eventKey: event.eventKey } });
            created++;
          }
        });
      }
    }
  }
  return { created, checked };
}

export async function listMedications(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const rows = await db
    .select({
      id: medications.id,
      familyId: medications.familyId,
      name: medications.name,
      dose: medications.dose,
      schedule: medications.schedule,
      doseTimes: medications.doseTimes,
      timeZone: medications.timeZone,
      startDate: medications.startDate,
      endDate: medications.endDate,
      notes: medications.notes,
      assigneeId: medications.assigneeId,
      escalationRecipientId: medications.escalationRecipientId,
      active: medications.active,
      createdBy: medications.createdBy,
      assigneeName: users.name,
    })
    .from(medications)
    .leftJoin(users, eq(medications.assigneeId, users.id))
    .where(
      and(eq(medications.familyId, familyId), eq(medications.active, true))
    )
    .orderBy(asc(medications.name))
    .limit(100);
  const now = new Date();
  const activeRows = rows
    .map(row => {
      const timeZone = isValidTimeZone(row.timeZone) ? row.timeZone : "UTC";
      return { ...row, timeZone, doseDate: dateKeyInZone(now, timeZone) };
    })
    .filter(
      row =>
        (!row.startDate || row.startDate <= row.doseDate) &&
        (!row.endDate || row.endDate >= row.doseDate)
    );
  if (!activeRows.length) return [];
  const doseDates = [...new Set(activeRows.map(row => row.doseDate))];
  const logs = await db
    .select({
      medicationId: doseConfirmations.medicationId,
      doseDate: doseConfirmations.doseDate,
      doseTime: doseConfirmations.doseTime,
      status: doseConfirmations.status,
      confirmedAt: doseConfirmations.confirmedAt,
      confirmedBy: doseConfirmations.confirmedBy,
      confirmerName: users.name,
      note: doseConfirmations.note,
    })
    .from(doseConfirmations)
    .leftJoin(users, eq(doseConfirmations.confirmedBy, users.id))
    .where(
      and(
        eq(doseConfirmations.familyId, familyId),
        inArray(doseConfirmations.doseDate, doseDates),
        inArray(
          doseConfirmations.medicationId,
          activeRows.map(row => row.id)
        )
      )
    );
  const logMap = new Map(
    logs.map(log => [
      `${log.medicationId}:${log.doseDate}:${log.doseTime}`,
      log,
    ])
  );
  return activeRows.map(row => ({
    ...row,
    doses: storedDoseTimes(row.doseTimes).map(doseTime => ({
      time: doseTime,
      confirmation: logMap.get(`${row.id}:${row.doseDate}:${doseTime}`) ?? null,
    })),
  }));
}

export async function createMedication(
  userId: number,
  familyId: number,
  input: {
    name: string;
    dose: string;
    schedule: string;
    doseTimes: string;
    timeZone: string;
    startDate?: string | null;
    endDate?: string | null;
    notes?: string | null;
    assigneeId?: number | null;
    escalationRecipientId?: number | null;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  await requireAssigneeInFamily(input.assigneeId, familyId);
  await requireEscalationRecipientInFamily(input.escalationRecipientId, familyId);
  const doseTimes = normalizeDoseTimes(input.doseTimes);
  if (!isValidTimeZone(input.timeZone))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a valid IANA time zone.",
    });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  await db.insert(medications).values({
    ...input,
    doseTimes: doseTimes.join(","),
    name: input.name.trim(),
    dose: input.dose.trim(),
    schedule: input.schedule.trim(),
    familyId,
    createdBy: userId,
    active: true,
  });
  return { success: true };
}

export async function updateMedication(
  userId: number,
  familyId: number,
  medicationId: number,
  input: {
    name: string;
    dose: string;
    schedule: string;
    doseTimes: string;
    timeZone: string;
    startDate?: string | null;
    endDate?: string | null;
    notes?: string | null;
    assigneeId?: number | null;
    escalationRecipientId?: number | null;
    active: boolean;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [medication] = await db
    .select({
      id: medications.id,
      createdBy: medications.createdBy,
      assigneeId: medications.assigneeId,
    })
    .from(medications)
    .where(
      and(eq(medications.id, medicationId), eq(medications.familyId, familyId))
    )
    .limit(1);
  if (!medication) throw new TRPCError({ code: "NOT_FOUND" });
  if (
    !managers.includes(role) &&
    medication.createdBy !== userId &&
    medication.assigneeId !== userId
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  await requireAssigneeInFamily(input.assigneeId, familyId);
  await requireEscalationRecipientInFamily(input.escalationRecipientId, familyId);
  const doseTimes = normalizeDoseTimes(input.doseTimes);
  if (!isValidTimeZone(input.timeZone))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a valid IANA time zone.",
    });
  await db
    .update(medications)
    .set({
      ...input,
      doseTimes: doseTimes.join(","),
      name: input.name.trim(),
      dose: input.dose.trim(),
      schedule: input.schedule.trim(),
    })
    .where(
      and(eq(medications.id, medicationId), eq(medications.familyId, familyId))
    );
  return { success: true };
}

export async function confirmDose(
  userId: number,
  familyId: number,
  medicationId: number,
  doseDate: string,
  doseTime: string,
  note?: string | null
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [medication] = await tx
      .select({
        id: medications.id,
        active: medications.active,
        doseTimes: medications.doseTimes,
        timeZone: medications.timeZone,
        startDate: medications.startDate,
        endDate: medications.endDate,
      })
      .from(medications)
      .where(
        and(
          eq(medications.id, medicationId),
          eq(medications.familyId, familyId)
        )
      )
      .limit(1)
      .for("update");
    if (!medication || !medication.active)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This medication is no longer active.",
      });
    const timeZone = isValidTimeZone(medication.timeZone)
      ? medication.timeZone
      : "UTC";
    const now = new Date();
    const today = dateKeyInZone(now, timeZone);
    if (doseDate !== today)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Confirmations are recorded for the medication's current local date only.",
      });
    if (
      (medication.startDate && today < medication.startDate) ||
      (medication.endDate && today > medication.endDate)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This medication is outside its active date range.",
      });
    if (!storedDoseTimes(medication.doseTimes).includes(doseTime))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a scheduled dose time.",
      });
    if (!canConfirmDoseAt(doseDate, doseTime, timeZone, now))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This dose cannot be confirmed before its scheduled local time.",
      });
    const [existing] = await tx
      .select({ id: doseConfirmations.id })
      .from(doseConfirmations)
      .where(
        and(
          eq(doseConfirmations.familyId, familyId),
          eq(doseConfirmations.medicationId, medicationId),
          eq(doseConfirmations.doseDate, doseDate),
          eq(doseConfirmations.doseTime, doseTime)
        )
      )
      .limit(1);
    if (existing)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This dose already has a confirmation for this local date.",
      });
    await tx.insert(doseConfirmations).values({
      familyId,
      medicationId,
      doseDate,
      doseTime,
      status: note?.trim() ? "needs_follow_up" : "confirmed",
      note: note?.trim() || null,
      confirmedBy: userId,
      confirmedAt: new Date(),
    });
    await tx.update(notificationEvents).set({ status: "cancelled" }).where(and(eq(notificationEvents.familyId, familyId), eq(notificationEvents.medicationId, medicationId), eq(notificationEvents.doseDate, doseDate), eq(notificationEvents.doseTime, doseTime), or(eq(notificationEvents.status, "created"), eq(notificationEvents.status, "read"))));
    return { success: true };
  });
}

export async function listEvents(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db
    .select({
      id: careEvents.id,
      title: careEvents.title,
      kind: careEvents.kind,
      startsAt: careEvents.startsAt,
      timeZone: careEvents.timeZone,
      location: careEvents.location,
      escortId: careEvents.escortId,
      escortName: users.name,
      reminderMinutes: careEvents.reminderMinutes,
      questions: careEvents.questions,
      visitNotes: careEvents.visitNotes,
      createdBy: careEvents.createdBy,
    })
    .from(careEvents)
    .leftJoin(users, eq(careEvents.escortId, users.id))
    .where(eq(careEvents.familyId, familyId))
    .orderBy(asc(careEvents.startsAt))
    .limit(200);
}

export async function createEvent(
  userId: number,
  familyId: number,
  input: {
    title: string;
    kind: "appointment" | "visit";
    startsAtLocal: string;
    timeZone: string;
    location?: string | null;
    escortId?: number | null;
    reminderMinutes: number;
    questions?: string | null;
    visitNotes?: string | null;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  await requireAssigneeInFamily(input.escortId, familyId);
  const resolved = resolveLocalDateTime(input.startsAtLocal, input.timeZone);
  if (!resolved.ok)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid appointment time: ${resolved.reason}.`,
    });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const { startsAtLocal: _local, ...eventFields } = input;
  const [result] = await db.insert(careEvents).values({
    ...eventFields,
    startsAt: resolved.instant,
    familyId,
    createdBy: userId,
    title: input.title.trim(),
  });
  await db.insert(careAuditLog).values({ familyId, actorId: userId, action: "event.created", resourceType: "event", resourceId: Number((result as { insertId?: number | bigint }).insertId), previousValues: null, newValues: { ...eventFields, title: input.title.trim(), startsAt: resolved.instant } });
  return { success: true };
}

export async function updateEvent(
  userId: number,
  familyId: number,
  eventId: number,
  input: {
    title: string;
    kind: "appointment" | "visit";
    startsAtLocal: string;
    timeZone: string;
    location?: string | null;
    escortId?: number | null;
    reminderMinutes: number;
    questions?: string | null;
    visitNotes?: string | null;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  await requireAssigneeInFamily(input.escortId, familyId);
  const resolved = resolveLocalDateTime(input.startsAtLocal, input.timeZone);
  if (!resolved.ok)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid appointment time: ${resolved.reason}.`,
    });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [event] = await tx
      .select()
      .from(careEvents)
      .where(and(eq(careEvents.id, eventId), eq(careEvents.familyId, familyId)))
      .limit(1)
      .for("update");
    if (!event) throw new TRPCError({ code: "NOT_FOUND" });
    if (!managers.includes(role) && event.createdBy !== userId)
      throw new TRPCError({ code: "FORBIDDEN" });
    const { startsAtLocal: _local, ...fields } = input;
    await tx
      .update(careEvents)
      .set({ ...fields, startsAt: resolved.instant, title: input.title.trim() })
      .where(
        and(eq(careEvents.id, eventId), eq(careEvents.familyId, familyId))
      );
    await recordAudit(tx, { familyId, actorId: userId, action: "event.updated", resourceType: "event", resourceId: eventId, previousValues: { title: event.title, kind: event.kind, startsAt: event.startsAt, timeZone: event.timeZone, location: event.location, escortId: event.escortId, reminderMinutes: event.reminderMinutes, questions: event.questions, visitNotes: event.visitNotes }, newValues: { ...fields, title: input.title.trim(), startsAt: resolved.instant } });
    return { success: true };
  });
}

export async function deleteEvent(
  userId: number,
  familyId: number,
  eventId: number
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [event] = await tx
      .select()
      .from(careEvents)
      .where(and(eq(careEvents.id, eventId), eq(careEvents.familyId, familyId)))
      .limit(1)
      .for("update");
    if (!event) throw new TRPCError({ code: "NOT_FOUND" });
    if (!managers.includes(role) && event.createdBy !== userId)
      throw new TRPCError({ code: "FORBIDDEN" });
    await tx
      .delete(careEvents)
      .where(
        and(eq(careEvents.id, eventId), eq(careEvents.familyId, familyId))
      );
    await recordAudit(tx, { familyId, actorId: userId, action: "event.deleted", resourceType: "event", resourceId: eventId, previousValues: { title: event.title, kind: event.kind, startsAt: event.startsAt, location: event.location }, newValues: null });
    return { success: true };
  });
}

export async function listCareNotes(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db
    .select({
      id: careNotes.id,
      kind: careNotes.kind,
      body: careNotes.body,
      isConfirmedFact: careNotes.isConfirmedFact,
      createdAt: careNotes.createdAt,
      createdBy: careNotes.createdBy,
      authorName: users.name,
    })
    .from(careNotes)
    .innerJoin(users, eq(careNotes.createdBy, users.id))
    .where(eq(careNotes.familyId, familyId))
    .orderBy(desc(careNotes.createdAt))
    .limit(200);
}

export async function createCareNote(
  userId: number,
  familyId: number,
  input: {
    kind: "update" | "visit_note" | "question" | "handoff" | "need";
    body: string;
    isConfirmedFact: boolean;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  await db
    .insert(careNotes)
    .values({ ...input, familyId, createdBy: userId, body: input.body.trim() });
  return { success: true };
}

async function requireNeedBuyerInFamily(
  buyerId: number | null | undefined,
  familyId: number
) {
  if (buyerId == null) return;
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [member] = await db
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.familyId, familyId),
        eq(familyMembers.userId, buyerId)
      )
    )
    .limit(1);
  if (!member)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a current member of this family as the buyer.",
    });
}

async function requireResourceEditor(
  userId: number,
  role: FamilyRole,
  createdBy: number
) {
  if (!managers.includes(role) && createdBy !== userId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only the person who added this record or a family coordinator can change it.",
    });
}

export async function listHouseholdNeeds(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [rows, familyMembersWithNames] = await Promise.all([
    db
      .select()
      .from(householdNeeds)
      .where(eq(householdNeeds.familyId, familyId))
      .orderBy(
        asc(householdNeeds.completed),
        desc(householdNeeds.priority),
        asc(householdNeeds.createdAt)
      ),
    db
      .select({ userId: familyMembers.userId, name: users.name })
      .from(familyMembers)
      .innerJoin(users, eq(familyMembers.userId, users.id))
      .where(eq(familyMembers.familyId, familyId)),
  ]);
  const namesByMemberId = new Map(
    familyMembersWithNames.map(member => [member.userId, member.name])
  );
  return rows.map(row => {
    const buyerIsCurrentMember =
      row.buyerId != null && namesByMemberId.has(row.buyerId);
    return {
      ...row,
      buyerId: buyerIsCurrentMember ? row.buyerId : null,
      buyerName: buyerIsCurrentMember
        ? (namesByMemberId.get(row.buyerId!) ?? null)
        : null,
    };
  });
}

export async function createHouseholdNeed(
  userId: number,
  familyId: number,
  input: {
    name: string;
    quantity?: string | null;
    priority: "low" | "medium" | "high";
    buyerId?: number | null;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  await requireNeedBuyerInFamily(input.buyerId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [result] = await db.insert(householdNeeds).values({
    ...input,
    familyId,
    name: input.name.trim(),
    quantity: input.quantity?.trim() || null,
    createdBy: userId,
  });
  return {
    id: Number((result as { insertId?: number | bigint }).insertId),
    success: true,
  };
}

export async function updateHouseholdNeed(
  userId: number,
  familyId: number,
  needId: number,
  input: {
    name: string;
    quantity?: string | null;
    priority: "low" | "medium" | "high";
    buyerId?: number | null;
    completed: boolean;
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [existing] = await db
    .select()
    .from(householdNeeds)
    .where(
      and(eq(householdNeeds.id, needId), eq(householdNeeds.familyId, familyId))
    )
    .limit(1);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
  await requireResourceEditor(userId, role, existing.createdBy);
  await requireNeedBuyerInFamily(input.buyerId, familyId);
  await db
    .update(householdNeeds)
    .set({
      name: input.name.trim(),
      quantity: input.quantity?.trim() || null,
      priority: input.priority,
      buyerId: input.buyerId ?? null,
      completed: input.completed,
    })
    .where(
      and(eq(householdNeeds.id, needId), eq(householdNeeds.familyId, familyId))
    );
  return { success: true };
}

export async function deleteHouseholdNeed(
  userId: number,
  familyId: number,
  needId: number
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [existing] = await db
    .select()
    .from(householdNeeds)
    .where(
      and(eq(householdNeeds.id, needId), eq(householdNeeds.familyId, familyId))
    )
    .limit(1);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
  await requireResourceEditor(userId, role, existing.createdBy);
  await db
    .delete(householdNeeds)
    .where(
      and(eq(householdNeeds.id, needId), eq(householdNeeds.familyId, familyId))
    );
  return { success: true };
}

type ContactKind = "provider" | "clinic" | "family" | "emergency";
type ContactFields = {
  kind: ContactKind;
  name: string;
  organization?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};
const cleanContactFields = (input: ContactFields) => ({
  ...input,
  name: input.name.trim(),
  organization: input.organization?.trim() || null,
  phone: input.phone?.trim() || null,
  email: input.email?.trim() || null,
  notes: input.notes?.trim() || null,
});

export async function listImportantContacts(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db
    .select()
    .from(importantContacts)
    .where(eq(importantContacts.familyId, familyId))
    .orderBy(asc(importantContacts.kind), asc(importantContacts.name));
}

export async function createImportantContact(
  userId: number,
  familyId: number,
  input: ContactFields
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [result] = await db
    .insert(importantContacts)
    .values({ ...cleanContactFields(input), familyId, createdBy: userId });
  return {
    id: Number((result as { insertId?: number | bigint }).insertId),
    success: true,
  };
}

export async function updateImportantContact(
  userId: number,
  familyId: number,
  contactId: number,
  input: ContactFields
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [existing] = await db
    .select()
    .from(importantContacts)
    .where(
      and(
        eq(importantContacts.id, contactId),
        eq(importantContacts.familyId, familyId)
      )
    )
    .limit(1);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
  await requireResourceEditor(userId, role, existing.createdBy);
  await db
    .update(importantContacts)
    .set(cleanContactFields(input))
    .where(
      and(
        eq(importantContacts.id, contactId),
        eq(importantContacts.familyId, familyId)
      )
    );
  return { success: true };
}

export async function deleteImportantContact(
  userId: number,
  familyId: number,
  contactId: number
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [existing] = await db
    .select()
    .from(importantContacts)
    .where(
      and(
        eq(importantContacts.id, contactId),
        eq(importantContacts.familyId, familyId)
      )
    )
    .limit(1);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
  await requireResourceEditor(userId, role, existing.createdBy);
  await db
    .delete(importantContacts)
    .where(
      and(
        eq(importantContacts.id, contactId),
        eq(importantContacts.familyId, familyId)
      )
    );
  return { success: true };
}


function taskCollaborationSnapshot(task: any) {
  return {
    title: task.title,
    description: task.description ?? null,
    dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
    priority: task.priority,
    assigneeId: task.assigneeId ?? null,
    status: task.status,
    recurrence: task.recurrence,
    notes: task.notes ?? null,
  };
}

function storedTaskSnapshot(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function requireFamilyUser(tx: any, familyId: number, userId: number) {
  const [member] = await tx.select({ id: familyMembers.id }).from(familyMembers)
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId))).limit(1);
  if (!member) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a current member of this family." });
}

export async function listCollaborationRequests(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.select().from(taskCollaborationRequests).where(eq(taskCollaborationRequests.familyId, familyId)).orderBy(desc(taskCollaborationRequests.createdAt)).limit(100);
}

export async function requestTaskCollaboration(userId: number, familyId: number, taskId: number, targetId: number, kind: "help" | "swap") {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  if (userId === targetId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose another family member." });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [task] = await tx.select().from(careTasks).where(and(eq(careTasks.id, taskId), eq(careTasks.familyId, familyId))).limit(1).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    if (task.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "Completed tasks cannot be reassigned." });
    if (kind === "swap" && task.assigneeId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the current assignee can request a responsibility swap." });
    await requireFamilyUser(tx, familyId, targetId);
    const pending = await tx.select({ id: taskCollaborationRequests.id }).from(taskCollaborationRequests).where(and(eq(taskCollaborationRequests.taskId, taskId), eq(taskCollaborationRequests.status, "pending"))).limit(1);
    if (pending.length) throw new TRPCError({ code: "CONFLICT", message: "A decision is already pending for this task." });
    const [result] = await tx.insert(taskCollaborationRequests).values({ familyId, taskId, requesterId: userId, targetId, kind, status: "pending", taskSnapshot: taskCollaborationSnapshot(task) });
    const requestId = Number((result as { insertId?: number | bigint }).insertId);
    await recordAudit(tx, { familyId, actorId: userId, action: `task.${kind}_requested`, resourceType: "task", resourceId: taskId, previousValues: null, newValues: { requestId, targetId } });
    return { success: true, requestId };
  });
}

export async function respondTaskCollaboration(userId: number, familyId: number, requestId: number, accept: boolean) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const [requestHint] = await tx.select({ taskId: taskCollaborationRequests.taskId }).from(taskCollaborationRequests).where(and(eq(taskCollaborationRequests.id, requestId), eq(taskCollaborationRequests.familyId, familyId))).limit(1);
    if (!requestHint) throw new TRPCError({ code: "NOT_FOUND" });
    const [task] = await tx.select().from(careTasks).where(and(eq(careTasks.id, requestHint.taskId), eq(careTasks.familyId, familyId))).limit(1).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    const [request] = await tx.select().from(taskCollaborationRequests).where(and(eq(taskCollaborationRequests.id, requestId), eq(taskCollaborationRequests.familyId, familyId))).limit(1).for("update");
    if (!request) throw new TRPCError({ code: "NOT_FOUND" });
    if (request.targetId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the invited family member may respond." });
    if (request.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "This request already has a decision." });
    await requireFamilyUser(tx, familyId, userId);
    if (request.taskId !== task.id) throw new TRPCError({ code: "CONFLICT", message: "The request no longer matches this task." });
    if (task.status === "completed" || JSON.stringify(taskCollaborationSnapshot(task)) !== JSON.stringify(storedTaskSnapshot(request.taskSnapshot)))
      throw new TRPCError({ code: "CONFLICT", message: "The task changed after this request; ask again using its current details." });
    const nextStatus = accept ? "accepted" : "declined";
    if (accept) {
      const oldAssignee = task.assigneeId ?? null;
      await tx.update(careTasks).set({ assigneeId: userId }).where(and(eq(careTasks.id, task.id), eq(careTasks.familyId, familyId)));
      await recordAudit(tx, { familyId, actorId: userId, action: "task.assigned_by_approval", resourceType: "task", resourceId: task.id, previousValues: { assigneeId: oldAssignee }, newValues: { assigneeId: userId, requestId } });
    }
    await tx.update(taskCollaborationRequests).set({ status: nextStatus, respondedAt: new Date() }).where(and(eq(taskCollaborationRequests.id, requestId), eq(taskCollaborationRequests.familyId, familyId), eq(taskCollaborationRequests.status, "pending")));
    await recordAudit(tx, { familyId, actorId: userId, action: `task.${request.kind}_${nextStatus}`, resourceType: "task", resourceId: task.id, previousValues: { requestStatus: "pending" }, newValues: { requestStatus: nextStatus } });
    return { success: true, accepted: accept };
  });
}

export async function listAbsences(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const rows = await db.select().from(careAbsences).where(eq(careAbsences.familyId, familyId)).orderBy(asc(careAbsences.startDate)).limit(100);
  return Promise.all(rows.map(async absence => {
    const affectedTasks = await db.select({ id: careTasks.id, title: careTasks.title, dueAt: careTasks.dueAt, status: careTasks.status, assigneeId: careTasks.assigneeId }).from(careTasks).where(and(eq(careTasks.familyId, familyId), eq(careTasks.assigneeId, absence.memberId)));
    return { ...absence, affectedTasks: affectedTasks.filter(task => task.status !== "completed" && (!task.dueAt || (new Date(task.dueAt).toISOString().slice(0, 10) >= absence.startDate && new Date(task.dueAt).toISOString().slice(0, 10) <= absence.endDate))) };
  }));
}

export async function createAbsence(userId: number, familyId: number, input: { memberId: number; startDate: string; endDate: string; note?: string | null }) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  if (input.endDate < input.startDate) throw new TRPCError({ code: "BAD_REQUEST", message: "End date must be on or after start date." });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  await requireFamilyUser(db, familyId, input.memberId);
  const [result] = await db.insert(careAbsences).values({ ...input, note: input.note?.trim() || null, familyId, createdBy: userId });
  await db.insert(careAuditLog).values({ familyId, actorId: userId, action: "absence.recorded", resourceType: "absence", resourceId: Number((result as { insertId?: number | bigint }).insertId), previousValues: null, newValues: { memberId: input.memberId, startDate: input.startDate, endDate: input.endDate } });
  return { success: true };
}

export async function listCareAudit(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.select().from(careAuditLog).where(eq(careAuditLog.familyId, familyId)).orderBy(desc(careAuditLog.createdAt)).limit(200);
}

export async function listCareHandoffs(userId: number, familyId: number) {
  await requireMembership(userId, familyId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const handoffs = await db.select().from(careHandoffs).where(eq(careHandoffs.familyId, familyId)).orderBy(desc(careHandoffs.createdAt)).limit(100);
  return Promise.all(handoffs.map(async handoff => {
    const ids = Array.isArray(handoff.pendingTaskIds) ? handoff.pendingTaskIds : [];
    const pendingTasks = ids.length ? await db.select({ id: careTasks.id, title: careTasks.title, status: careTasks.status, dueAt: careTasks.dueAt }).from(careTasks).where(and(eq(careTasks.familyId, familyId), inArray(careTasks.id, ids))) : [];
    return { ...handoff, pendingTasks: pendingTasks.filter(task => task.status !== "completed") };
  }));
}

export async function createCareHandoff(userId: number, familyId: number, input: { eventId: number; recipientId: number; context: string; pendingTaskIds: number[] }) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    await requireFamilyUser(tx, familyId, input.recipientId);
    const [event] = await tx.select({ id: careEvents.id }).from(careEvents).where(and(eq(careEvents.id, input.eventId), eq(careEvents.familyId, familyId), eq(careEvents.kind, "visit"))).limit(1);
    if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Choose a family visit from this family." });
    const taskIds = [...new Set(input.pendingTaskIds)];
    if (taskIds.length) {
      const tasks = await tx.select({ id: careTasks.id, status: careTasks.status }).from(careTasks).where(and(eq(careTasks.familyId, familyId), inArray(careTasks.id, taskIds)));
      if (tasks.length !== taskIds.length || tasks.some(task => task.status === "completed")) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose only pending tasks from this family." });
    }
    const [result] = await tx.insert(careHandoffs).values({ familyId, eventId: input.eventId, fromUserId: userId, recipientId: input.recipientId, context: input.context.trim(), pendingTaskIds: taskIds });
    const id = Number((result as { insertId?: number | bigint }).insertId);
    await recordAudit(tx, { familyId, actorId: userId, action: "handoff.created", resourceType: "handoff", resourceId: id, previousValues: null, newValues: { recipientId: input.recipientId, eventId: input.eventId, pendingTaskIds: taskIds } });
    return { success: true, id };
  });
}
