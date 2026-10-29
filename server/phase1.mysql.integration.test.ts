import { createServer, type Server } from "node:http";
import express from "express";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { and, desc, eq, gt } from "drizzle-orm";
import superjson from "superjson";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { dateKeyInZone, resolveLocalDateTime } from "../shared/timezone";
import { COOKIE_NAME } from "../shared/const";
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
import { appRouter, type AppRouter } from "./routers";
import { createContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { getDb, upsertUser } from "./db";
import { reconcileDueDoseNotifications } from "./care-db";

const testDatabaseUrl = process.env.CARE_CIRCLE_TEST_DATABASE_URL;
if (testDatabaseUrl) {
  const parsed = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
    !databaseName.startsWith("carecircle_test_")
  ) {
    throw new Error(
      "Refusing MySQL integration test: CARE_CIRCLE_TEST_DATABASE_URL must point to localhost and a database named carecircle_test_*"
    );
  }
  process.env.DATABASE_URL = testDatabaseUrl;
}

const suite = testDatabaseUrl ? describe : describe.skip;
const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  projectId: process.env.MANUS_PROJECT_ID,
  jwtSecret: process.env.MANUS_JWT_SECRET,
};

suite("Care Circle against an isolated local MySQL database", () => {
  let server: Server;
  let endpoint = "";
  let database: Awaited<ReturnType<typeof getDb>>;
  const sessionTokens = new Map<number, string>();
  const testRun = `cc-mysql-it-${Date.now()}`;
  const identities = [
    { id: 0, name: "Morgan Owner", email: `${testRun}-owner@example.test` },
    { id: 0, name: "Riley Other", email: `${testRun}-other@example.test` },
    {
      id: 0,
      name: "Taylor Successor",
      email: `${testRun}-successor@example.test`,
    },
  ];

  async function clientFor(index: number) {
    const token = sessionTokens.get(index);
    if (!token) throw new Error(`Missing test session for user ${index}`);
    return createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: endpoint,
          transformer: superjson,
          headers: () => ({ cookie: `${COOKIE_NAME}=${token}` }),
        }),
      ],
    });
  }

  async function errorCode(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      caught => caught
    );
    return (error as { data?: { code?: string } } | null)?.data?.code;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeAll(async () => {
    if (!testDatabaseUrl)
      throw new Error("Set CARE_CIRCLE_TEST_DATABASE_URL to opt in.");
    process.env.MANUS_PROJECT_ID = "care-circle-local-mysql-integration";
    process.env.MANUS_JWT_SECRET = `local-test-${testRun}-secret`;
    database = await getDb();
    if (!database)
      throw new Error("Could not connect to the isolated test DB.");

    for (let index = 0; index < identities.length; index += 1) {
      const identity = identities[index]!;
      await upsertUser({
        openId: identity.email,
        name: identity.name,
        email: identity.email,
        loginMethod: "mysql-integration-test",
        role: "user",
        lastSignedIn: new Date(),
      });
      const [user] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.openId, identity.email))
        .limit(1);
      if (!user) throw new Error("Test account was not persisted.");
      identity.id = user.id;
      sessionTokens.set(
        index,
        await sdk.createSessionToken(identity.email, { name: identity.name })
      );
    }

    const app = express();
    app.use(express.json());
    app.use(
      "/api/trpc",
      createExpressMiddleware({ router: appRouter, createContext })
    );
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not start on a TCP port.");
    endpoint = `http://127.0.0.1:${address.port}/api/trpc`;
  });

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    const client = database as
      | (typeof database & { $client?: { end?: () => Promise<void> } })
      | null;
    await client?.$client?.end?.();
    for (const [key, value] of Object.entries(originalEnv)) {
      const envKey =
        key === "databaseUrl"
          ? "DATABASE_URL"
          : key === "projectId"
            ? "MANUS_PROJECT_ID"
            : "MANUS_JWT_SECRET";
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  });

  it("covers care, collaboration, household insights, and in-app notifications", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
    const owner = await clientFor(0);
    const otherOwner = await clientFor(1);
    const successor = await clientFor(2);
    const familyA = await owner.care.families.create.mutate({
      name: `${testRun} Family A`,
    });
    const familyB = await otherOwner.care.families.create.mutate({
      name: `${testRun} Family B`,
    });

    expect(
      await errorCode(
        otherOwner.care.families.members.query({ familyId: familyA.id })
      )
    ).toBe("FORBIDDEN");

    const medicationA = await owner.care.medications.create.mutate({
      familyId: familyA.id,
      name: "Two-time medication",
      dose: "As prescribed by clinician",
      schedule: "Two times daily",
      doseTimes: "08:00,20:00",
      timeZone: "America/New_York",
    });
    const medicationB = await otherOwner.care.medications.create.mutate({
      familyId: familyB.id,
      name: "Other family record",
      dose: "As prescribed",
      schedule: "Daily",
      doseTimes: "09:00",
      timeZone: "America/Chicago",
    });
    const [foreignMedication] = await database!
      .select({ id: medications.id, name: medications.name })
      .from(medications)
      .where(
        and(
          eq(medications.familyId, familyB.id),
          eq(medications.name, "Other family record")
        )
      )
      .limit(1);
    expect(foreignMedication?.id).toBeTruthy();
    expect(
      await errorCode(
        owner.care.medications.update.mutate({
          familyId: familyA.id,
          medicationId: foreignMedication!.id,
          name: "Should not cross families",
          dose: "1",
          schedule: "Daily",
          doseTimes: "09:00",
          timeZone: "America/New_York",
          active: true,
        })
      )
    ).toBe("NOT_FOUND");
    expect(medicationA.success).toBe(true);
    expect(medicationB.success).toBe(true);

    const localDoseDate = dateKeyInZone(new Date(), "America/New_York");
    const medicationRows = await owner.care.medications.list.query({
      familyId: familyA.id,
    });
    const medicationId = medicationRows[0]!.id;
    expect(medicationRows[0]!.doses.map(dose => dose.time)).toEqual([
      "08:00",
      "20:00",
    ]);
    await owner.care.medications.confirm.mutate({
      familyId: familyA.id,
      medicationId,
      doseDate: localDoseDate,
      doseTime: "08:00",
    });
    expect(
      await errorCode(
        owner.care.medications.confirm.mutate({
          familyId: familyA.id,
          medicationId,
          doseDate: localDoseDate,
          doseTime: "20:00",
        })
      )
    ).toBe("BAD_REQUEST");
    vi.setSystemTime(new Date("2026-10-29T00:00:00.000Z"));
    await owner.care.medications.confirm.mutate({
      familyId: familyA.id,
      medicationId,
      doseDate: localDoseDate,
      doseTime: "20:00",
    });
    expect(
      await errorCode(
        owner.care.medications.confirm.mutate({
          familyId: familyA.id,
          medicationId,
          doseDate: localDoseDate,
          doseTime: "08:00",
        })
      )
    ).toBe("CONFLICT");
    const confirmed = await owner.care.medications.list.query({
      familyId: familyA.id,
    });
    expect(
      confirmed[0]!.doses.map(dose => dose.confirmation?.doseTime ?? null)
    ).toEqual(["08:00", "20:00"]);
    expect(
      await errorCode(
        otherOwner.care.medications.confirm.mutate({
          familyId: familyB.id,
          medicationId,
          doseDate: localDoseDate,
          doseTime: "08:00",
        })
      )
    ).toBe("NOT_FOUND");

    const localDate = dateKeyInZone(
      new Date(Date.now() + 86_400_000),
      "America/New_York"
    );
    await owner.care.events.create.mutate({
      familyId: familyA.id,
      title: "Clinic follow-up",
      kind: "appointment",
      startsAtLocal: `${localDate}T11:00`,
      timeZone: "America/New_York",
      location: "Clinic",
      reminderMinutes: 30,
      questions: "Review the clinician's instructions",
    });
    const [event] = await database!
      .select({
        id: careEvents.id,
        startsAt: careEvents.startsAt,
        timeZone: careEvents.timeZone,
        createdBy: careEvents.createdBy,
      })
      .from(careEvents)
      .where(
        and(
          eq(careEvents.familyId, familyA.id),
          eq(careEvents.title, "Clinic follow-up")
        )
      )
      .limit(1);
    expect(event?.timeZone).toBe("America/New_York");
    const expectedInstant = resolveLocalDateTime(
      `${localDate}T11:00`,
      "America/New_York"
    );
    if (!expectedInstant.ok)
      throw new Error("The test appointment time should be unambiguous.");
    expect(event?.startsAt.toISOString()).toBe(
      expectedInstant.instant.toISOString()
    );
    const changedDate = dateKeyInZone(
      new Date(Date.now() + 172_800_000),
      "America/Chicago"
    );
    await owner.care.events.update.mutate({
      familyId: familyA.id,
      eventId: event!.id,
      title: "Clinic follow-up updated",
      kind: "appointment",
      startsAtLocal: `${changedDate}T10:00`,
      timeZone: "America/Chicago",
      location: "Clinic",
      reminderMinutes: 15,
      questions: "Updated question",
    });
    expect(
      await errorCode(
        otherOwner.care.events.update.mutate({
          familyId: familyB.id,
          eventId: event!.id,
          title: "Cross-family edit",
          kind: "appointment",
          startsAtLocal: `${changedDate}T10:00`,
          timeZone: "America/Chicago",
          reminderMinutes: 0,
        })
      )
    ).toBe("NOT_FOUND");
    expect(
      await errorCode(
        owner.care.events.create.mutate({
          familyId: familyA.id,
          title: "DST gap",
          kind: "appointment",
          startsAtLocal: "2026-03-08T02:30",
          timeZone: "America/New_York",
          reminderMinutes: 0,
        })
      )
    ).toBe("BAD_REQUEST");
    await owner.care.events.create.mutate({
      familyId: familyA.id,
      title: "Temporary visit",
      kind: "visit",
      startsAtLocal: `${localDate}T14:00`,
      timeZone: "America/New_York",
      reminderMinutes: 0,
    });
    const [temporary] = await database!
      .select({ id: careEvents.id })
      .from(careEvents)
      .where(
        and(
          eq(careEvents.familyId, familyA.id),
          eq(careEvents.title, "Temporary visit")
        )
      )
      .limit(1);
    await owner.care.events.delete.mutate({
      familyId: familyA.id,
      eventId: temporary!.id,
    });
    expect(
      await database!
        .select()
        .from(careEvents)
        .where(eq(careEvents.id, temporary!.id))
    ).toHaveLength(0);

    await owner.care.tasks.create.mutate({
      familyId: familyA.id,
      title: "Shared task",
      priority: "medium",
      assigneeId: identities[0]!.id,
      recurrence: "none",
    });
    const [task] = await database!
      .select()
      .from(careTasks)
      .where(
        and(
          eq(careTasks.familyId, familyA.id),
          eq(careTasks.title, "Shared task")
        )
      )
      .limit(1);
    await owner.care.tasks.update.mutate({
      familyId: familyA.id,
      taskId: task!.id,
      title: task!.title,
      description: null,
      dueAt: null,
      priority: "medium",
      assigneeId: identities[0]!.id,
      status: "completed",
      recurrence: "none",
      notes: null,
    });
    const [taskCompletion] = await database!
      .select()
      .from(careTaskCompletions)
      .where(eq(careTaskCompletions.taskId, task!.id))
      .limit(1);
    expect(taskCompletion?.completedBy).toBe(identities[0]!.id);
    await owner.care.notes.create.mutate({
      familyId: familyA.id,
      kind: "handoff",
      body: "Shared care note",
      isConfirmedFact: false,
    });

    const acceptedInvite = await owner.care.families.invite.mutate({
      familyId: familyA.id,
      email: identities[2]!.email,
      role: "coordinator",
    });
    await successor.care.invitations.accept.mutate({
      token: acceptedInvite.token,
    });
    const successorMember = (
      await owner.care.families.members.query({ familyId: familyA.id })
    ).find(member => member.userId === identities[2]!.id)!;

    const need = await owner.care.householdNeeds.create.mutate({
      familyId: familyA.id,
      name: "Household supplies",
      quantity: "2",
      priority: "high",
      buyerId: identities[2]!.id,
    });
    expect(need.success).toBe(true);
    await owner.care.importantContacts.create.mutate({
      familyId: familyA.id,
      kind: "emergency",
      name: "Family contact",
      phone: "+1-555-0100",
    });
    const needRows = await owner.care.householdNeeds.list.query({
      familyId: familyA.id,
    });
    expect(needRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Household supplies",
          buyerName: "Taylor Successor",
        }),
      ])
    );
    await expect(
      owner.care.importantContacts.list.query({ familyId: familyA.id })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "emergency", name: "Family contact" }),
      ])
    );

    await owner.care.tasks.create.mutate({
      familyId: familyA.id,
      title: "Support requested",
      dueAt: new Date("2026-10-29T10:00:00.000Z"),
      priority: "medium",
      assigneeId: identities[0]!.id,
      recurrence: "none",
      estimatedMinutes: 45,
    });
    const [supportTask] = await database!
      .select()
      .from(careTasks)
      .where(
        and(
          eq(careTasks.familyId, familyA.id),
          eq(careTasks.title, "Support requested")
        )
      )
      .limit(1);
    const supportRequest = await owner.care.collaboration.request.mutate({
      familyId: familyA.id,
      taskId: supportTask!.id,
      targetId: identities[2]!.id,
      kind: "help",
    });
    await successor.care.collaboration.respond.mutate({
      familyId: familyA.id,
      requestId: supportRequest.requestId,
      accept: true,
    });
    const reassignedTask = (
      await owner.care.tasks.list.query({ familyId: familyA.id })
    ).find(item => item.id === supportTask!.id);
    expect(reassignedTask?.assigneeId).toBe(identities[2]!.id);

    await owner.care.absences.create.mutate({
      familyId: familyA.id,
      memberId: identities[2]!.id,
      startDate: "2026-10-29",
      endDate: "2026-10-30",
      note: "Out of town",
    });
    const absenceRows = await owner.care.absences.list.query({
      familyId: familyA.id,
    });
    expect(absenceRows[0]?.affectedTasks.map(task => task.id)).toContain(
      supportTask!.id
    );

    await owner.care.events.create.mutate({
      familyId: familyA.id,
      title: "After-visit review",
      kind: "visit",
      startsAtLocal: "2026-10-30T14:00",
      timeZone: "UTC",
      reminderMinutes: 0,
    });
    const [visit] = await database!
      .select({ id: careEvents.id })
      .from(careEvents)
      .where(
        and(
          eq(careEvents.familyId, familyA.id),
          eq(careEvents.title, "After-visit review")
        )
      )
      .limit(1);
    await owner.care.handoffs.create.mutate({
      familyId: familyA.id,
      eventId: visit!.id,
      recipientId: identities[2]!.id,
      context: "Review the clinician-provided plan.",
      pendingTaskIds: [supportTask!.id],
    });
    await expect(
      owner.care.audit.list.query({ familyId: familyA.id })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "task.assigned_by_approval" }),
        expect.objectContaining({ action: "absence.recorded" }),
      ])
    );
    await expect(
      owner.care.handoffs.list.query({ familyId: familyA.id })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          context: "Review the clinician-provided plan.",
        }),
      ])
    );
    const reportRange = {
      familyId: familyA.id,
      startDate: "2026-10-29",
      endDate: "2026-11-04",
    };
    const workload = await owner.care.phase3.workload.query(reportRange);
    expect(workload.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: identities[2]!.id,
          estimatedMinutesTotal: 45,
        }),
      ])
    );
    await expect(
      owner.care.phase3.weeklySummary.query(reportRange)
    ).resolves.toMatchObject({ unassignedTasks: expect.any(Number) });
    await owner.care.phase3.setDigestPreference.mutate({
      familyId: familyA.id,
      enabled: true,
    });
    await expect(
      owner.care.phase3.digestPreference.query({ familyId: familyA.id })
    ).resolves.toMatchObject({ enabled: true, deliveryConfigured: false });
    await owner.care.phase3.setDigestPreference.mutate({
      familyId: familyA.id,
      enabled: false,
    });

    await owner.care.phase3.setNotificationPreferences.mutate({
      familyId: familyA.id,
      reminderOptIn: true,
      escalationOptIn: false,
    });
    await successor.care.phase3.setNotificationPreferences.mutate({
      familyId: familyA.id,
      reminderOptIn: false,
      escalationOptIn: true,
    });
    const notificationMedication = await owner.care.medications.create.mutate({
      familyId: familyA.id,
      name: "Notification integration medication",
      dose: "As prescribed",
      schedule: "Daily",
      doseTimes: "00:00",
      timeZone: "UTC",
      startDate: "2026-10-29",
      endDate: "2026-10-29",
      assigneeId: identities[0]!.id,
      escalationRecipientId: identities[2]!.id,
    });
    expect(notificationMedication.success).toBe(true);
    const [notificationMedicationRow] = await database!
      .select({ id: medications.id })
      .from(medications)
      .where(
        and(
          eq(medications.familyId, familyA.id),
          eq(medications.name, "Notification integration medication")
        )
      )
      .limit(1);
    expect(notificationMedicationRow?.id).toBeTruthy();
    vi.setSystemTime(new Date("2026-10-29T00:10:00.000Z"));
    await reconcileDueDoseNotifications(new Date());
    const dueInbox = await owner.care.phase3.inbox.query({
      familyId: familyA.id,
    });
    expect(dueInbox.map(item => item.kind)).toContain("due_reminder");
    expect(dueInbox.map(item => item.kind)).toContain("unconfirmed_10m");
    expect(
      dueInbox.every(item => item.emailDeliveryStatus === "not_configured")
    ).toBe(true);
    vi.setSystemTime(new Date("2026-10-29T00:20:00.000Z"));
    await reconcileDueDoseNotifications(new Date());
    const escalationInbox = await successor.care.phase3.inbox.query({
      familyId: familyA.id,
    });
    expect(escalationInbox.map(item => item.kind)).toContain("escalation_20m");
    await owner.care.medications.confirm.mutate({
      familyId: familyA.id,
      medicationId: notificationMedicationRow!.id,
      doseDate: "2026-10-29",
      doseTime: "00:00",
    });
    const cancelledInbox = await owner.care.phase3.inbox.query({
      familyId: familyA.id,
    });
    expect(
      cancelledInbox
        .filter(item => item.doseTime === "00:00")
        .every(item => item.status === "cancelled")
    ).toBe(true);
    const exportBeforeDelete = await successor.care.families.export.mutate({
      familyId: familyA.id,
    });
    expect(exportBeforeDelete).toMatchObject({
      collaborationRequests: expect.any(Array),
      absences: expect.any(Array),
      auditHistory: expect.any(Array),
      handoffs: expect.any(Array),
      notificationEvents: expect.any(Array),
    });

    await owner.care.families.transferOwnership.mutate({
      familyId: familyA.id,
      memberId: successorMember.id,
    });
    await owner.care.families.invite.mutate({
      familyId: familyA.id,
      email: identities[1]!.email,
      role: "viewer",
    });
    await owner.auth.deleteAccount.mutate();

    const [former] = await database!
      .select({ id: users.id, email: users.email, openId: users.openId })
      .from(users)
      .where(gt(users.id, Math.max(...identities.map(identity => identity.id))))
      .orderBy(desc(users.id))
      .limit(1);
    expect(former?.id).toBeTruthy();
    expect(former?.email).toBeNull();
    expect(former?.openId).not.toBe(identities[0]!.email);
    expect(
      await database!
        .select()
        .from(users)
        .where(eq(users.openId, identities[0]!.email))
    ).toHaveLength(0);
    expect(
      await database!.select().from(families).where(eq(families.id, familyA.id))
    ).toHaveLength(1);
    expect(
      await database!
        .select()
        .from(familyMembers)
        .where(eq(familyMembers.userId, identities[0]!.id))
    ).toHaveLength(0);
    const [retainedTask] = await database!
      .select()
      .from(careTasks)
      .where(eq(careTasks.id, task!.id))
      .limit(1);
    expect(retainedTask).toMatchObject({
      createdBy: former!.id,
      assigneeId: null,
    });
    const [retainedMedication] = await database!
      .select()
      .from(medications)
      .where(eq(medications.id, medicationId))
      .limit(1);
    expect(retainedMedication).toMatchObject({
      createdBy: former!.id,
      assigneeId: null,
    });
    expect(
      await database!
        .select()
        .from(doseConfirmations)
        .where(eq(doseConfirmations.medicationId, medicationId))
    ).toHaveLength(2);
    expect(
      await database!
        .select()
        .from(careEvents)
        .where(
          and(
            eq(careEvents.id, event!.id),
            eq(careEvents.createdBy, former!.id)
          )
        )
    ).toHaveLength(1);
    expect(
      await database!
        .select()
        .from(careNotes)
        .where(
          and(
            eq(careNotes.familyId, familyA.id),
            eq(careNotes.body, "Shared care note")
          )
        )
    ).toHaveLength(1);
    expect(
      (
        await database!
          .select()
          .from(familyInvitations)
          .where(
            and(
              eq(familyInvitations.familyId, familyA.id),
              eq(familyInvitations.status, "revoked")
            )
          )
      ).length
    ).toBeGreaterThan(0);
    await expect(
      successor.care.families.export.mutate({ familyId: familyA.id })
    ).resolves.toMatchObject({ family: { id: familyA.id } });
  });
});
