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
} from "../shared/timezone";
import { nextRecurringDueDate, normalizeDoseTimes, storedDoseTimes } from "./care-utils";
import {
  careEvents,
  careNotes,
  careTaskCompletions,
  careTasks,
  doseConfirmations,
  families,
  familyInvitations,
  familyMembers,
  medications,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";

export type FamilyRole = "owner" | "coordinator" | "caregiver" | "viewer";
const managers: FamilyRole[] = ["owner", "coordinator"];

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
    invitations,
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
  ]);
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
    invitations,
  };
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
  const [target] = await db
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(
      and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, familyId))
    )
    .limit(1);
  if (!target) throw new TRPCError({ code: "NOT_FOUND" });
  if (target.role === "owner")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The family owner role cannot be changed here.",
    });
  await db
    .update(familyMembers)
    .set({ role: nextRole })
    .where(
      and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, familyId))
    );
  return { success: true };
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
    .select({ id: familyMembers.id, role: familyMembers.role })
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
    if (!formerMemberId)
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      .update(careTasks)
      .set({ assigneeId: null })
      .where(eq(careTasks.assigneeId, userId));
    await tx
      .update(medications)
      .set({ assigneeId: null })
      .where(eq(medications.assigneeId, userId));
    await tx
      .update(careEvents)
      .set({ escortId: null })
      .where(eq(careEvents.escortId, userId));
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
  await db.insert(careTasks).values({
    ...input,
    familyId,
    title: input.title.trim(),
    createdBy: userId,
    status: "new",
  });
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
  await db
    .delete(careTasks)
    .where(and(eq(careTasks.id, taskId), eq(careTasks.familyId, familyId)));
  return { success: true };
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
      active: medications.active,
      createdBy: medications.createdBy,
      assigneeName: users.name,
    })
    .from(medications)
    .leftJoin(users, eq(medications.assigneeId, users.id))
    .where(and(eq(medications.familyId, familyId), eq(medications.active, true)))
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
        inArray(
          doseConfirmations.doseDate,
          doseDates
        ),
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
      confirmation:
        logMap.get(`${row.id}:${row.doseDate}:${doseTime}`) ?? null,
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
  }
) {
  const role = await requireMembership(userId, familyId);
  requireWrite(role);
  await requireAssigneeInFamily(input.assigneeId, familyId);
  const doseTimes = normalizeDoseTimes(input.doseTimes);
  if (!isValidTimeZone(input.timeZone))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid IANA time zone." });
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
  const doseTimes = normalizeDoseTimes(input.doseTimes);
  if (!isValidTimeZone(input.timeZone))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid IANA time zone." });
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
      throw new TRPCError({ code: "NOT_FOUND", message: "This medication is no longer active." });
    const timeZone = isValidTimeZone(medication.timeZone)
      ? medication.timeZone
      : "UTC";
    const now = new Date();
    const today = dateKeyInZone(now, timeZone);
    if (doseDate !== today)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmations are recorded for the medication's current local date only." });
    if (
      (medication.startDate && today < medication.startDate) ||
      (medication.endDate && today > medication.endDate)
    )
      throw new TRPCError({ code: "BAD_REQUEST", message: "This medication is outside its active date range." });
    if (!storedDoseTimes(medication.doseTimes).includes(doseTime))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a scheduled dose time." });
    if (!canConfirmDoseAt(doseDate, doseTime, timeZone, now))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This dose cannot be confirmed before its scheduled local time.",
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
  await db.insert(careEvents).values({
    ...eventFields,
    startsAt: resolved.instant,
    familyId,
    createdBy: userId,
    title: input.title.trim(),
  });
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
      .select({ id: careEvents.id, createdBy: careEvents.createdBy })
      .from(careEvents)
      .where(
        and(eq(careEvents.id, eventId), eq(careEvents.familyId, familyId))
      )
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
      .select({ id: careEvents.id, createdBy: careEvents.createdBy })
      .from(careEvents)
      .where(
        and(eq(careEvents.id, eventId), eq(careEvents.familyId, familyId))
      )
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
