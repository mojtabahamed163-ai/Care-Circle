import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import superjson from "superjson";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { COOKIE_NAME } from "../shared/const";
import { appRouter, type AppRouter } from "./routers";
import { createContext } from "./_core/context";
import { sdk } from "./_core/sdk";
const databaseMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("./db", () => databaseMocks);

type Row = Record<string, any>;
type TableState = Record<string, Row[]>;
type QueryRecord = {
  operation: "select" | "insert" | "update" | "delete";
  table: string;
  sql?: string;
  params?: unknown[];
};

const dialect = new MySqlDialect();
const fixedNow = new Date("2026-10-28T12:00:00.000Z");

function createUser(id: number, name: string, email: string) {
  const now = new Date("2026-10-01T12:00:00.000Z");
  return {
    id,
    openId: `test-open-id-${id}`,
    name,
    email,
    loginMethod: "test",
    role: "user" as const,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

const testUsers = [
  createUser(1, "Alex One", "one@example.test"),
  createUser(2, "Bryn Two", "two@example.test"),
  createUser(3, "Casey Three", "three@example.test"),
];

function makeInitialState(): TableState {
  const old = new Date("2026-10-20T08:00:00.000Z");
  return {
    users: structuredClone(testUsers),
    families: [
      { id: 10, name: "Family Alpha", createdBy: 1, createdAt: old },
      { id: 20, name: "Family Bravo", createdBy: 2, createdAt: old },
    ],
    familyMembers: [
      {
        id: 101,
        familyId: 10,
        userId: 1,
        role: "owner",
        joinedAt: old,
      },
      {
        id: 201,
        familyId: 20,
        userId: 2,
        role: "owner",
        joinedAt: old,
      },
      {
        id: 202,
        familyId: 20,
        userId: 3,
        role: "caregiver",
        joinedAt: old,
      },
    ],
    familyInvitations: [
      {
        id: 250,
        familyId: 20,
        email: "outsider@example.test",
        role: "caregiver",
        tokenHash: "revoked-or-private-family-hash",
        status: "pending",
        invitedBy: 2,
        acceptedBy: null,
        createdAt: old,
        expiresAt: new Date("2026-11-04T12:00:00.000Z"),
      },
    ],
    careTasks: [
      {
        id: 200,
        familyId: 20,
        title: "Private task in family Bravo",
        description: "Synthetic test data",
        dueAt: new Date("2026-10-29T12:00:00.000Z"),
        priority: "high",
        assigneeId: 2,
        status: "new",
        recurrence: "none",
        notes: null,
        createdBy: 2,
        completedBy: null,
        completedAt: null,
        generatedFromTaskId: null,
        createdAt: old,
        updatedAt: old,
      },
    ],
    careTaskCompletions: [],
    medications: [
      {
        id: 220,
        familyId: 20,
        name: "Private medication",
        dose: "As prescribed",
        schedule: "Daily",
        doseTimes: "",
        timeZone: "UTC",
        startDate: null,
        endDate: null,
        notes: null,
        assigneeId: 2,
        active: true,
        createdBy: 2,
        createdAt: old,
        updatedAt: old,
      },
    ],
    doseConfirmations: [],
    careEvents: [
      {
        id: 230,
        familyId: 20,
        title: "Private appointment",
        kind: "appointment",
        startsAt: new Date("2026-10-29T12:00:00.000Z"),
        timeZone: null,
        location: null,
        escortId: 2,
        reminderMinutes: 60,
        questions: null,
        visitNotes: null,
        createdBy: 2,
        createdAt: old,
        updatedAt: old,
      },
    ],
    careNotes: [
      {
        id: 240,
        familyId: 20,
        kind: "handoff",
        body: "Private journal entry",
        isConfirmedFact: false,
        createdBy: 2,
        createdAt: old,
      },
    ],
  };
}

function sameValue(left: unknown, right: unknown) {
  if (left instanceof Date && right instanceof Date)
    return left.getTime() === right.getTime();
  return left === right;
}

function matchingRows(rows: Row[], tableName: string, condition?: SQL): Row[] {
  if (!condition) return rows;
  const { sql, params } = dialect.sqlToQuery(condition);
  const predicates = [...sql.matchAll(/`([^`]+)`\.`([^`]+)` = \?/g)];
  return rows.filter(row => {
    let paramIndex = 0;
    for (const predicate of predicates) {
      const [, referencedTable, column] = predicate;
      const value = params[paramIndex++];
      if (referencedTable !== tableName || !(column in row)) continue;
      if (!sameValue(row[column], value)) return false;
    }
    return true;
  });
}

function joinRows(
  state: TableState,
  tableName: string,
  joinNames: string[],
  rows: Row[]
): Row[] {
  return rows.map(row => {
    const result = { ...row };
    if (joinNames.includes("users")) {
      const userId =
        tableName === "familyMembers"
          ? row.userId
          : tableName === "careTaskCompletions"
            ? row.completedBy
            : tableName === "doseConfirmations"
              ? row.confirmedBy
              : tableName === "careEvents"
                ? row.escortId
                : tableName === "careNotes"
                  ? row.createdBy
                  : row.assigneeId;
      const user = state.users.find(candidate => candidate.id === userId);
      if (tableName === "familyMembers") {
        result.name = user?.name ?? null;
        result.email = user?.email ?? null;
      } else if (tableName === "careTaskCompletions") {
        result.completedByName = user?.name ?? null;
      } else if (tableName === "doseConfirmations") {
        result.confirmerName = user?.name ?? null;
      } else if (tableName === "careEvents") {
        result.escortName = user?.name ?? null;
      } else if (tableName === "careNotes") {
        result.authorName = user?.name ?? null;
      } else if (tableName === "careTasks") {
        result.assigneeName = user?.name ?? null;
      }
    }
    if (tableName === "familyMembers" && joinNames.includes("families")) {
      const family = state.families.find(
        candidate => candidate.id === row.familyId
      );
      if (family) return { ...family, role: row.role };
    }
    if (tableName === "familyInvitations" && joinNames.includes("families")) {
      result.familyName =
        state.families.find(candidate => candidate.id === row.familyId)?.name ??
        null;
    }
    return result;
  });
}

function createMemoryDatabase(state: TableState, log: QueryRecord[]) {
  const rowsFor = (table: unknown) => {
    const name = getTableName(table as any);
    if (!state[name]) state[name] = [];
    return { name, rows: state[name] };
  };

  const database: any = {
    select: (fields?: Record<string, unknown>) => {
      let source = "";
      let condition: SQL | undefined;
      let limitCount: number | undefined;
      const joinNames: string[] = [];
      const builder: any = {
        from(table: unknown) {
          const resolved = rowsFor(table);
          source = resolved.name;
          return builder;
        },
        innerJoin(table: unknown) {
          joinNames.push(rowsFor(table).name);
          return builder;
        },
        leftJoin(table: unknown) {
          joinNames.push(rowsFor(table).name);
          return builder;
        },
        where(next: SQL) {
          condition = next;
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit(count: number) {
          limitCount = count;
          return builder;
        },
        for() {
          return builder;
        },
        then(
          onFulfilled: (value: Row[]) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) {
          try {
            const resolved = rowsForName(source);
            const compiled = condition
              ? dialect.sqlToQuery(condition)
              : { sql: "", params: [] };
            log.push({
              operation: "select",
              table: source,
              sql: compiled.sql,
              params: compiled.params,
            });
            let selected = matchingRows(resolved, source, condition);
            selected = joinRows(state, source, joinNames, selected);
            if (source === "familyInvitations" && condition) {
              const { sql, params } = dialect.sqlToQuery(condition);
              if (sql.includes("`familyInvitations`.`expiresAt` > ?")) {
                const rawExpiry = params[params.length - 1];
                const expiry =
                  rawExpiry instanceof Date
                    ? rawExpiry
                    : new Date(`${String(rawExpiry).replace(" ", "T")}Z`);
                selected = selected.filter(
                  invite =>
                    invite.expiresAt instanceof Date &&
                    invite.expiresAt > expiry
                );
              }
            }
            if (limitCount !== undefined)
              selected = selected.slice(0, limitCount);
            if (fields) {
              selected = selected.map(row =>
                Object.fromEntries(
                  Object.entries(fields).map(([alias, column]) => {
                    const candidate = column as {
                      name?: string;
                      table?: unknown;
                    };
                    const columnName = candidate.name ?? alias;
                    const columnTable = candidate.table
                      ? getTableName(candidate.table as any)
                      : source;
                    const value =
                      columnTable === source
                        ? row[columnName]
                        : (row[alias] ?? row[columnName]);
                    return [alias, value];
                  })
                )
              );
            }
            return Promise.resolve(selected).then(onFulfilled, onRejected);
          } catch (error) {
            return Promise.reject(error).then(onFulfilled, onRejected);
          }
        },
      };
      return builder;
    },
    insert: (table: unknown) => {
      const { name, rows } = rowsFor(table);
      return {
        values: (input: Row | Row[]) => {
          const promise = Promise.resolve().then(() => {
            const inputRows = Array.isArray(input) ? input : [input];
            log.push({ operation: "insert", table: name });
            const inserted = inputRows.map(raw => {
              if (
                name === "familyMembers" &&
                rows.some(
                  row =>
                    row.familyId === raw.familyId && row.userId === raw.userId
                )
              )
                return { insertId: 0 };
              if (
                name === "careTasks" &&
                raw.generatedFromTaskId &&
                rows.some(
                  row => row.generatedFromTaskId === raw.generatedFromTaskId
                )
              )
                return { insertId: 0 };
              const id =
                rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
              const defaults: Row = {
                id,
                createdAt: fixedNow,
                updatedAt: fixedNow,
                joinedAt: fixedNow,
                status: name === "familyInvitations" ? "pending" : undefined,
                active: name === "medications" ? true : undefined,
                completedBy: null,
                completedAt: null,
                acceptedBy: null,
              };
              const row = { ...defaults, ...raw, id };
              rows.push(row);
              return { insertId: id };
            });
            return inserted;
          });
          (promise as any).onDuplicateKeyUpdate = () => promise;
          return promise;
        },
      };
    },
    update: (table: unknown) => {
      const { name, rows } = rowsFor(table);
      return {
        set: (values: Row) => ({
          where: async (condition: SQL) => {
            const compiled = dialect.sqlToQuery(condition);
            log.push({
              operation: "update",
              table: name,
              sql: compiled.sql,
              params: compiled.params,
            });
            const matching = matchingRows(rows, name, condition);
            for (const row of matching) Object.assign(row, values);
            return [{ affectedRows: matching.length }];
          },
        }),
      };
    },
    delete: (table: unknown) => {
      const { name, rows } = rowsFor(table);
      return {
        where: async (condition: SQL) => {
          const compiled = dialect.sqlToQuery(condition);
          log.push({
            operation: "delete",
            table: name,
            sql: compiled.sql,
            params: compiled.params,
          });
          const matching = matchingRows(rows, name, condition);
          state[name] = rows.filter(row => !matching.includes(row));
          return [{ affectedRows: matching.length }];
        },
      };
    },
    transaction: async (callback: (tx: any) => Promise<unknown>) => {
      const snapshot = structuredClone(state);
      try {
        return await callback(database);
      } catch (error) {
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, snapshot);
        throw error;
      }
    },
  };

  function rowsForName(name: string) {
    if (!state[name]) state[name] = [];
    return state[name];
  }

  return database;
}

function getErrorCode(error: unknown): string | undefined {
  return (
    (error as { data?: { code?: string } } | null)?.data?.code ??
    (error as { code?: string } | null)?.code
  );
}

describe("phase 1 HTTP integration with isolated in-memory MySQL-shaped test double", () => {
  let server: Server;
  let endpoint = "";
  let state: TableState;
  let log: QueryRecord[];
  let database: any;
  const tokens = new Map<number, string>();
  const originalProjectId = process.env.MANUS_PROJECT_ID;
  const originalJwtSecret = process.env.MANUS_JWT_SECRET;

  function clientFor(userId?: number) {
    const token = userId ? tokens.get(userId) : undefined;
    return createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: endpoint,
          transformer: superjson,
          headers: () => (token ? { cookie: `${COOKIE_NAME}=${token}` } : {}),
        }),
      ],
    });
  }

  beforeAll(async () => {
    process.env.MANUS_PROJECT_ID = "care-circle-test-project";
    process.env.MANUS_JWT_SECRET = "test-only-secret-not-used-outside-vitest";
    for (const user of testUsers)
      tokens.set(
        user.id,
        await sdk.createSessionToken(user.openId, { name: user.name ?? "" })
      );

    const app = express();
    app.use(express.json());
    app.use(
      "/api/trpc",
      createExpressMiddleware({ router: appRouter, createContext })
    );
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test HTTP server did not bind to a TCP port.");
    endpoint = `http://127.0.0.1:${address.port}/api/trpc`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (originalProjectId === undefined) delete process.env.MANUS_PROJECT_ID;
    else process.env.MANUS_PROJECT_ID = originalProjectId;
    if (originalJwtSecret === undefined) delete process.env.MANUS_JWT_SECRET;
    else process.env.MANUS_JWT_SECRET = originalJwtSecret;
  });

  beforeEach(() => {
    state = makeInitialState();
    log = [];
    database = createMemoryDatabase(state, log);
    databaseMocks.getDb.mockResolvedValue(database);
    databaseMocks.getUserByOpenId.mockImplementation(async (openId: string) =>
      testUsers.find(user => user.openId === openId)
    );
    databaseMocks.upsertUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects unauthenticated HTTP calls to protected care procedures", async () => {
    const response = await clientFor()
      .care.tasks.list.query({ familyId: 10 })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(response)).toBe("UNAUTHORIZED");
    expect(log).toEqual([]);
  });

  it("resolves the signed-in account from a valid HTTP session cookie", async () => {
    const user = await clientFor(1).auth.me.query();
    expect(user).toMatchObject({
      id: 1,
      openId: "test-open-id-1",
      email: "one@example.test",
    });
    expect(log).toEqual([]);
  });

  it("blocks direct cross-family reads and writes even when the caller supplies another family's IDs", async () => {
    const caller = clientFor(1);
    const requests: Array<[string, () => Promise<unknown>]> = [
      [
        "family export",
        () => caller.care.families.export.mutate({ familyId: 20 }),
      ],
      [
        "member list",
        () => caller.care.families.members.query({ familyId: 20 }),
      ],
      [
        "role change",
        () =>
          caller.care.families.changeRole.mutate({
            familyId: 20,
            memberId: 202,
            role: "viewer",
          }),
      ],
      [
        "member removal",
        () =>
          caller.care.families.removeMember.mutate({
            familyId: 20,
            memberId: 202,
          }),
      ],
      ["leave", () => caller.care.families.leave.mutate({ familyId: 20 })],
      [
        "invitation list",
        () => caller.care.families.invitations.query({ familyId: 20 }),
      ],
      [
        "create invitation",
        () =>
          caller.care.families.invite.mutate({
            familyId: 20,
            email: "one@example.test",
            role: "caregiver",
          }),
      ],
      [
        "revoke invitation",
        () =>
          caller.care.families.revokeInvitation.mutate({
            familyId: 20,
            invitationId: 250,
          }),
      ],
      ["task list", () => caller.care.tasks.list.query({ familyId: 20 })],
      [
        "task create",
        () =>
          caller.care.tasks.create.mutate({
            familyId: 20,
            title: "Injected task",
            priority: "low",
            recurrence: "none",
          }),
      ],
      [
        "task update",
        () =>
          caller.care.tasks.update.mutate({
            familyId: 20,
            taskId: 200,
            title: "Injected update",
            priority: "low",
            status: "new",
            recurrence: "none",
          }),
      ],
      [
        "task delete",
        () => caller.care.tasks.delete.mutate({ familyId: 20, taskId: 200 }),
      ],
      [
        "medication list",
        () => caller.care.medications.list.query({ familyId: 20 }),
      ],
      [
        "medication create",
        () =>
          caller.care.medications.create.mutate({
            familyId: 20,
            name: "Injected",
            dose: "1",
            schedule: "daily",
            doseTimes: "08:00,20:00",
            timeZone: "America/New_York",
          }),
      ],
      [
        "medication update",
        () =>
          caller.care.medications.update.mutate({
            familyId: 20,
            medicationId: 220,
            name: "Injected",
            dose: "1",
            schedule: "daily",
            doseTimes: "08:00,20:00",
            timeZone: "America/New_York",
            active: true,
          }),
      ],
      [
        "dose confirmation",
        () =>
          caller.care.medications.confirm.mutate({
            familyId: 20,
            medicationId: 220,
            doseDate: "2026-10-28",
            doseTime: "once",
          }),
      ],
      ["event list", () => caller.care.events.list.query({ familyId: 20 })],
      [
        "event update",
        () =>
          caller.care.events.update.mutate({
            familyId: 20,
            eventId: 230,
            title: "Injected event update",
            kind: "appointment",
            startsAtLocal: "2026-10-29T10:00",
            timeZone: "America/New_York",
            reminderMinutes: 0,
          }),
      ],
      [
        "event delete",
        () => caller.care.events.delete.mutate({ familyId: 20, eventId: 230 }),
      ],
      [
        "event create",
        () =>
          caller.care.events.create.mutate({
            familyId: 20,
            title: "Injected",
            kind: "visit",
            startsAtLocal: "2026-10-29T10:00",
            timeZone: "America/New_York",
            reminderMinutes: 0,
          }),
      ],
      ["journal list", () => caller.care.notes.list.query({ familyId: 20 })],
      [
        "journal create",
        () =>
          caller.care.notes.create.mutate({
            familyId: 20,
            kind: "update",
            body: "Injected",
            isConfirmedFact: false,
          }),
      ],
      [
        "ownership transfer",
        () =>
          caller.care.families.transferOwnership.mutate({
            familyId: 20,
            memberId: 202,
          }),
      ],
    ];

    for (const [label, request] of requests) {
      const start = log.length;
      const response = await request().then(
        () => null,
        error => error
      );
      expect(getErrorCode(response), label).toBe("FORBIDDEN");
      const requestLog = log.slice(start);
      expect(requestLog, label).toHaveLength(1);
      expect(requestLog[0], label).toMatchObject({
        operation: "select",
        table: "familyMembers",
        params: [20, 1],
      });
    }
    expect(log.some(entry => entry.operation !== "select")).toBe(false);
    expect(log.some(entry => entry.table !== "familyMembers")).toBe(false);
  });

  it("scopes resource IDs to the selected family even when a caller swaps IDs", async () => {
    const caller = clientFor(1);
    const foreignTaskUpdate = await caller.care.tasks.update
      .mutate({
        familyId: 10,
        taskId: 200,
        title: "Should not change",
        priority: "low",
        status: "new",
        recurrence: "none",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignTaskUpdate)).toBe("NOT_FOUND");

    const foreignMedicationUpdate = await caller.care.medications.update
      .mutate({
        familyId: 10,
        medicationId: 220,
        name: "Should not change",
        dose: "1",
        schedule: "daily",
        doseTimes: "08:00,20:00",
        timeZone: "America/New_York",
        active: true,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignMedicationUpdate)).toBe("NOT_FOUND");

    const foreignEventUpdate = await caller.care.events.update
      .mutate({
        familyId: 10,
        eventId: 230,
        title: "Should not change",
        kind: "appointment",
        startsAtLocal: "2026-10-30T10:00",
        timeZone: "America/New_York",
        reminderMinutes: 30,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignEventUpdate)).toBe("NOT_FOUND");
    const foreignEventDelete = await caller.care.events.delete
      .mutate({ familyId: 10, eventId: 230 })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignEventDelete)).toBe("NOT_FOUND");
    expect(state.careEvents.find(row => row.id === 230)?.title).toBe(
      "Private appointment"
    );

    const foreignDose = await caller.care.medications.confirm
      .mutate({
        familyId: 10,
        medicationId: 220,
        doseDate: "2026-10-28",
        doseTime: "once",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignDose)).toBe("NOT_FOUND");

    const foreignMember = await caller.care.families.changeRole
      .mutate({ familyId: 10, memberId: 202, role: "viewer" })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignMember)).toBe("NOT_FOUND");

    const foreignInvitation =
      await caller.care.families.revokeInvitation.mutate({
        familyId: 10,
        invitationId: 250,
      });
    expect(foreignInvitation).toEqual({ success: true });
    expect(state.familyInvitations.find(row => row.id === 250)?.status).toBe(
      "pending"
    );
    expect(state.careTasks.find(row => row.id === 200)?.title).toBe(
      "Private task in family Bravo"
    );
    expect(state.medications.find(row => row.id === 220)?.name).toBe(
      "Private medication"
    );
    const scopedRevoke = log.filter(entry => entry.operation === "update");
    expect(scopedRevoke).toHaveLength(1);
    expect(scopedRevoke[0]).toMatchObject({
      table: "familyInvitations",
      params: [250, 10, "pending"],
    });
  });

  it("creates a family, enforces email-bound invitations and roles, transfers ownership, and permits the former owner to leave", async () => {
    const owner = clientFor(1);
    const created = await owner.care.families.create.mutate({
      name: "Synthetic Care Circle",
    });
    expect(created).toMatchObject({
      role: "owner",
      name: "Synthetic Care Circle",
    });
    expect(state.familyMembers).toContainEqual(
      expect.objectContaining({
        familyId: created.id,
        userId: 1,
        role: "owner",
      })
    );

    const declinedInvite = await owner.care.families.invite.mutate({
      familyId: created.id,
      email: "three@example.test",
      role: "caregiver",
    });
    const declinedResult = await clientFor(3).care.invitations.decline.mutate({
      token: declinedInvite.token,
    });
    expect(declinedResult).toMatchObject({
      familyId: created.id,
      accepted: false,
    });
    expect(
      state.familyInvitations.find(
        row =>
          row.tokenHash ===
          createHash("sha256").update(declinedInvite.token).digest("hex")
      )?.status
    ).toBe("declined");

    const revokedInvite = await owner.care.families.invite.mutate({
      familyId: created.id,
      email: "two@example.test",
      role: "viewer",
    });
    const revokedRow = state.familyInvitations.find(
      row =>
        row.tokenHash ===
        createHash("sha256").update(revokedInvite.token).digest("hex")
    )!;
    await owner.care.families.revokeInvitation.mutate({
      familyId: created.id,
      invitationId: revokedRow.id,
    });
    expect(revokedRow.status).toBe("revoked");
    expect(
      await clientFor().care.invitations.preview.query({
        token: revokedInvite.token,
      })
    ).toBeNull();
    const revokedAccept = await clientFor(2)
      .care.invitations.accept.mutate({ token: revokedInvite.token })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(revokedAccept)).toBe("NOT_FOUND");

    const invitation = await owner.care.families.invite.mutate({
      familyId: created.id,
      email: "three@example.test",
      role: "caregiver",
    });
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const storedInvitation = state.familyInvitations.find(
      row =>
        row.tokenHash ===
        createHash("sha256").update(invitation.token).digest("hex")
    );
    expect(storedInvitation?.tokenHash).not.toBe(invitation.token);
    expect(storedInvitation?.tokenHash).toBe(
      (await import("node:crypto"))
        .createHash("sha256")
        .update(invitation.token)
        .digest("hex")
    );

    const wrongEmailResponse = await clientFor(2)
      .care.invitations.accept.mutate({ token: invitation.token })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(wrongEmailResponse), JSON.stringify(log)).toBe(
      "FORBIDDEN"
    );
    expect(
      state.familyMembers.some(
        row => row.familyId === created.id && row.userId === 2
      )
    ).toBe(false);

    const preview = await clientFor().care.invitations.preview.query({
      token: invitation.token,
    });
    expect(preview).toMatchObject({
      familyId: created.id,
      familyName: "Synthetic Care Circle",
      status: "pending",
    });
    const accepted = await clientFor(3).care.invitations.accept.mutate({
      token: invitation.token,
    });
    expect(accepted).toMatchObject({ familyId: created.id, accepted: true });
    const acceptedAgain = await clientFor(3)
      .care.invitations.accept.mutate({ token: invitation.token })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(acceptedAgain)).toBe("NOT_FOUND");
    const invitedMember = state.familyMembers.find(
      row => row.familyId === created.id && row.userId === 3
    );
    expect(invitedMember?.role).toBe("caregiver");

    await owner.care.tasks.create.mutate({
      familyId: created.id,
      title: "Owner-only edit",
      priority: "medium",
      recurrence: "none",
      assigneeId: 1,
    });
    const ownerTask = state.careTasks.find(
      row => row.familyId === created.id && row.title === "Owner-only edit"
    )!;
    const caregiverEdit = await clientFor(3)
      .care.tasks.update.mutate({
        familyId: created.id,
        taskId: ownerTask.id,
        title: "Unauthorized edit",
        priority: "high",
        status: "in_progress",
        recurrence: "none",
        assigneeId: 1,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(caregiverEdit)).toBe("FORBIDDEN");
    expect(ownerTask.title).toBe("Owner-only edit");

    await clientFor(3).care.tasks.create.mutate({
      familyId: created.id,
      title: "Caregiver task",
      priority: "low",
      recurrence: "none",
      assigneeId: 3,
    });
    const caregiverTask = state.careTasks.find(
      row => row.familyId === created.id && row.title === "Caregiver task"
    )!;
    await clientFor(3).care.tasks.update.mutate({
      familyId: created.id,
      taskId: caregiverTask.id,
      title: "Caregiver task amended",
      priority: "low",
      status: "in_progress",
      recurrence: "none",
      assigneeId: 3,
    });
    expect(caregiverTask.title).toBe("Caregiver task amended");
    const caregiverReassign = await clientFor(3)
      .care.tasks.update.mutate({
        familyId: created.id,
        taskId: caregiverTask.id,
        title: caregiverTask.title,
        priority: "low",
        status: "in_progress",
        recurrence: "none",
        assigneeId: 1,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(caregiverReassign)).toBe("FORBIDDEN");
    expect(caregiverTask.assigneeId).toBe(3);

    await owner.care.medications.create.mutate({
      familyId: created.id,
      name: "Owner medication",
      dose: "As prescribed",
      schedule: "Daily as written by family",
      doseTimes: "08:00,20:00",
      timeZone: "America/New_York",
      assigneeId: 1,
    });
    const ownerMedication = state.medications.find(
      row => row.familyId === created.id && row.name === "Owner medication"
    )!;
    const caregiverMedicationEdit = await clientFor(3)
      .care.medications.update.mutate({
        familyId: created.id,
        medicationId: ownerMedication.id,
        name: "Unauthorized medication edit",
        dose: "As prescribed",
        schedule: "Daily",
        doseTimes: "08:00,20:00",
        timeZone: "America/New_York",
        active: true,
        assigneeId: 1,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(caregiverMedicationEdit)).toBe("FORBIDDEN");
    expect(ownerMedication.name).toBe("Owner medication");
    const caregiverExport = await clientFor(3)
      .care.families.export.mutate({ familyId: created.id })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(caregiverExport)).toBe("FORBIDDEN");
    await owner.care.events.create.mutate({
      familyId: created.id,
      title: "Owner-created appointment",
      kind: "appointment",
      startsAtLocal: "2026-10-30T11:00",
      timeZone: "America/New_York",
      reminderMinutes: 60,
    });
    const ownerEvent = state.careEvents.find(
      row => row.title === "Owner-created appointment"
    )!;
    const caregiverEventEdit = await clientFor(3).care.events.update
      .mutate({
        familyId: created.id,
        eventId: ownerEvent.id,
        title: "Unauthorized event edit",
        kind: "appointment",
        startsAtLocal: "2026-10-30T12:00",
        timeZone: "America/New_York",
        reminderMinutes: 60,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(caregiverEventEdit)).toBe("FORBIDDEN");
    const caregiverEventDelete = await clientFor(3).care.events.delete
      .mutate({ familyId: created.id, eventId: ownerEvent.id })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(caregiverEventDelete)).toBe("FORBIDDEN");
    expect(ownerEvent.title).toBe("Owner-created appointment");

    await owner.care.families.changeRole.mutate({
      familyId: created.id,
      memberId: invitedMember!.id,
      role: "viewer",
    });
    const viewerCreate = await clientFor(3)
      .care.tasks.create.mutate({
        familyId: created.id,
        title: "Viewer write",
        priority: "low",
        recurrence: "none",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(viewerCreate)).toBe("FORBIDDEN");
    expect(state.careTasks.some(row => row.title === "Viewer write")).toBe(
      false
    );
    const viewerTasks = await clientFor(3).care.tasks.list.query({
      familyId: created.id,
    });
    expect(viewerTasks.map(task => task.title).sort()).toEqual([
      "Caregiver task amended",
      "Owner-only edit",
    ]);
    const viewerExport = await clientFor(3)
      .care.families.export.mutate({ familyId: created.id })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(viewerExport)).toBe("FORBIDDEN");

    await owner.care.families.removeMember.mutate({
      familyId: created.id,
      memberId: invitedMember!.id,
    });
    expect(
      state.familyMembers.some(
        row => row.familyId === created.id && row.userId === 3
      )
    ).toBe(false);
    const removedMemberAccess = await clientFor(3)
      .care.tasks.list.query({ familyId: created.id })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(removedMemberAccess)).toBe("FORBIDDEN");

    const replacementInvite = await owner.care.families.invite.mutate({
      familyId: created.id,
      email: "three@example.test",
      role: "caregiver",
    });
    await clientFor(3).care.invitations.accept.mutate({
      token: replacementInvite.token,
    });
    const replacementMember = state.familyMembers.find(
      row => row.familyId === created.id && row.userId === 3
    );
    expect(replacementMember?.role).toBe("caregiver");

    await owner.care.families.transferOwnership.mutate({
      familyId: created.id,
      memberId: replacementMember!.id,
    });
    expect(
      state.familyMembers.find(
        row => row.familyId === created.id && row.userId === 1
      )?.role
    ).toBe("coordinator");
    expect(
      state.familyMembers.find(
        row => row.familyId === created.id && row.userId === 3
      )?.role
    ).toBe("owner");
    const coordinatorExport = await owner.care.families.export.mutate({
      familyId: created.id,
    });
    expect(coordinatorExport.family.name).toBe("Synthetic Care Circle");

    const coordinatorTransfer = await owner.care.families.transferOwnership
      .mutate({ familyId: created.id, memberId: 101 })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(coordinatorTransfer)).toBe("FORBIDDEN");

    const ownerLeave = await clientFor(3)
      .care.families.leave.mutate({ familyId: created.id })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(ownerLeave)).toBe("FORBIDDEN");

    const coordinatorInvite = await owner.care.families.invite.mutate({
      familyId: created.id,
      email: "two@example.test",
      role: "viewer",
    });
    await clientFor(2).care.invitations.accept.mutate({
      token: coordinatorInvite.token,
    });
    const secondMember = state.familyMembers.find(
      row => row.familyId === created.id && row.userId === 2
    )!;
    await owner.care.families.changeRole.mutate({
      familyId: created.id,
      memberId: secondMember.id,
      role: "caregiver",
    });
    expect(
      state.familyMembers.find(row => row.id === secondMember.id)?.role
    ).toBe("caregiver");
    await owner.care.families.removeMember.mutate({
      familyId: created.id,
      memberId: secondMember.id,
    });
    expect(
      state.familyMembers.some(
        row => row.familyId === created.id && row.userId === 2
      )
    ).toBe(false);

    await owner.care.families.leave.mutate({ familyId: created.id });
    expect(
      state.familyMembers.some(
        row => row.familyId === created.id && row.userId === 1
      )
    ).toBe(false);
    const formerOwnerAccess = await owner.care.tasks.list
      .query({ familyId: created.id })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(formerOwnerAccess)).toBe("FORBIDDEN");
  });

  it("records tasks, medication confirmations, appointments and journal entries, then exports their family-scoped history", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
    const owner = clientFor(1);
    const dueAt = new Date("2026-10-29T15:00:00.000Z");
    await owner.care.tasks.create.mutate({
      familyId: 10,
      title: "Call the clinic",
      description: "Ask about the next appointment",
      dueAt,
      priority: "high",
      assigneeId: null,
      recurrence: "none",
      notes: null,
    });
    const task = state.careTasks.find(row => row.familyId === 10)!;
    const taskInput = {
      familyId: 10,
      taskId: task.id,
      title: task.title,
      description: task.description,
      dueAt: task.dueAt,
      priority: task.priority,
      assigneeId: task.assigneeId,
      recurrence: "none" as const,
      notes: task.notes,
    };
    await owner.care.tasks.update.mutate({ ...taskInput, status: "completed" });
    await owner.care.tasks.update.mutate({ ...taskInput, status: "completed" });
    await owner.care.tasks.update.mutate({
      ...taskInput,
      status: "in_progress",
    });
    await owner.care.tasks.update.mutate({ ...taskInput, status: "completed" });
    expect(
      state.careTaskCompletions.filter(row => row.taskId === task.id)
    ).toHaveLength(2);

    await owner.care.medications.create.mutate({
      familyId: 10,
      name: "Prescribed medicine",
      dose: "1 tablet",
      schedule: "Daily at 8:00 AM",
      doseTimes: "08:00,20:00",
      timeZone: "America/New_York",
      startDate: "2026-10-01",
      endDate: null,
      notes: null,
      assigneeId: null,
    });
    const medication = state.medications.find(row => row.familyId === 10)!;
    await owner.care.medications.update.mutate({
      familyId: 10,
      medicationId: medication.id,
      name: medication.name,
      dose: medication.dose,
      schedule: medication.schedule,
      doseTimes: medication.doseTimes,
      timeZone: medication.timeZone,
      startDate: medication.startDate,
      endDate: medication.endDate,
      notes: "Family follow-up note",
      assigneeId: medication.assigneeId,
      active: true,
    });
    expect(medication.notes).toBe("Family follow-up note");
    await owner.care.medications.confirm.mutate({
      familyId: 10,
      medicationId: medication.id,
      doseDate: "2026-10-28",
      doseTime: "08:00",
    });
    const earlyDose = await owner.care.medications.confirm
      .mutate({
        familyId: 10,
        medicationId: medication.id,
        doseDate: "2026-10-28",
        doseTime: "20:00",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(earlyDose)).toBe("BAD_REQUEST");
    expect(
      state.doseConfirmations.filter(row => row.medicationId === medication.id)
    ).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-29T00:00:00.000Z"));
    const duplicateDose = await owner.care.medications.confirm
      .mutate({
        familyId: 10,
        medicationId: medication.id,
        doseDate: "2026-10-28",
        doseTime: "08:00",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(duplicateDose)).toBe("CONFLICT");
    await owner.care.medications.confirm.mutate({
      familyId: 10,
      medicationId: medication.id,
      doseDate: "2026-10-28",
      doseTime: "20:00",
    });
    expect(
      state.doseConfirmations.filter(row => row.medicationId === medication.id)
    ).toHaveLength(2);

    await owner.care.events.create.mutate({
      familyId: 10,
      title: "Follow-up appointment",
      kind: "appointment",
      startsAtLocal: "2026-10-30T11:00",
      timeZone: "America/New_York",
      location: "Clinic",
      escortId: null,
      reminderMinutes: 60,
      questions: "Ask about next steps",
      visitNotes: null,
    });
    const event = state.careEvents.find(row => row.familyId === 10)!;
    expect(event.startsAt.toISOString()).toBe("2026-10-30T15:00:00.000Z");
    await owner.care.events.update.mutate({
      familyId: 10,
      eventId: event.id,
      title: "Follow-up appointment updated",
      kind: "appointment",
      startsAtLocal: "2026-10-30T10:00",
      timeZone: "America/Chicago",
      location: "Clinic",
      escortId: null,
      reminderMinutes: 30,
      questions: "Ask about next steps",
      visitNotes: null,
    });
    expect(event.startsAt.toISOString()).toBe("2026-10-30T15:00:00.000Z");
    expect(event.timeZone).toBe("America/Chicago");
    await owner.care.events.create.mutate({
      familyId: 10,
      title: "Temporary event",
      kind: "visit",
      startsAtLocal: "2026-10-31T10:00",
      timeZone: "America/Chicago",
      reminderMinutes: 0,
    });
    const temporaryEvent = state.careEvents.find(row => row.title === "Temporary event")!;
    await owner.care.events.delete.mutate({ familyId: 10, eventId: temporaryEvent.id });
    expect(state.careEvents.some(row => row.id === temporaryEvent.id)).toBe(false);
    await owner.care.notes.create.mutate({
      familyId: 10,
      kind: "handoff",
      body: "Call after the appointment with the confirmed instructions.",
      isConfirmedFact: false,
    });

    const tasks = await owner.care.tasks.list.query({ familyId: 10 });
    expect(tasks[0]?.completionHistory).toHaveLength(2);
    expect(tasks[0]?.completionHistory[0]?.completedByName).toBe("Alex One");
    const medications = await owner.care.medications.list.query({ familyId: 10 });
    expect(medications[0]?.doses).toHaveLength(2);
    expect(medications[0]?.doses[0]?.confirmation?.status).toBe("confirmed");
    expect(medications[0]?.doses[1]?.confirmation?.status).toBe("confirmed");
    const events = await owner.care.events.list.query({ familyId: 10 });
    expect(events[0]?.title).toBe("Follow-up appointment updated");
    expect(events[0]?.timeZone).toBe("America/Chicago");
    const notes = await owner.care.notes.list.query({ familyId: 10 });
    expect(notes[0]?.body).toContain("confirmed instructions");

    await owner.care.families.invite.mutate({
      familyId: 10,
      email: "export-check@example.test",
      role: "viewer",
    });

    const exportData = await owner.care.families.export.mutate({
      familyId: 10,
    });
    expect(exportData.taskCompletions).toHaveLength(2);
    expect(exportData.medications).toHaveLength(1);
    expect(exportData.doseConfirmations).toHaveLength(2);
    expect(exportData.events).toHaveLength(1);
    expect(exportData.careJournal).toHaveLength(1);
    expect(exportData.invitations).toHaveLength(1);
    expect(
      exportData.invitations.every(invitation => !("tokenHash" in invitation))
    ).toBe(true);
    expect(exportData.tasks.every(row => row.familyId === 10)).toBe(true);
    expect(
      exportData.taskCompletions.every(
        row => row.completedByName === "Alex One"
      )
    ).toBe(true);
  });

  it("rejects invalid medication dates and foreign assignees and creates one monthly successor", async () => {
    const owner = clientFor(1);

    const invalidCalendarDate = await owner.care.medications.confirm
      .mutate({
        familyId: 10,
        medicationId: 220,
        doseDate: "2026-02-30",
        doseTime: "once",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(invalidCalendarDate)).toBe("BAD_REQUEST");

    const invalidDoseTime = await owner.care.medications.confirm
      .mutate({
        familyId: 10,
        medicationId: 220,
        doseDate: "2026-10-28",
        doseTime: "25:00",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(invalidDoseTime)).toBe("BAD_REQUEST");

    const invalidMedicationZone = await owner.care.medications.create
      .mutate({
        familyId: 10,
        name: "Invalid time zone",
        dose: "As prescribed",
        schedule: "Daily",
        doseTimes: "08:00",
        timeZone: "Not/A_Zone",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(invalidMedicationZone)).toBe("BAD_REQUEST");

    const daylightSavingGap = await owner.care.events.create
      .mutate({
        familyId: 10,
        title: "Nonexistent local time",
        kind: "appointment",
        startsAtLocal: "2026-03-08T02:30",
        timeZone: "America/New_York",
        reminderMinutes: 0,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(daylightSavingGap)).toBe("BAD_REQUEST");
    expect(
      state.careEvents.some(row => row.title === "Nonexistent local time")
    ).toBe(false);

    const invertedMedicationRange = await owner.care.medications.create
      .mutate({
        familyId: 10,
        name: "Invalid date range",
        dose: "As prescribed",
        schedule: "As entered by family",
        doseTimes: "08:00",
        timeZone: "America/New_York",
        startDate: "2026-03-02",
        endDate: "2026-02-27",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(invertedMedicationRange)).toBe("BAD_REQUEST");
    expect(
      state.medications.some(row => row.name === "Invalid date range")
    ).toBe(false);

    const foreignAssignee = await owner.care.tasks.create
      .mutate({
        familyId: 10,
        title: "Assign outside family",
        priority: "medium",
        assigneeId: 2,
        recurrence: "none",
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignAssignee)).toBe("BAD_REQUEST");
    expect(
      state.careTasks.some(row => row.title === "Assign outside family")
    ).toBe(false);

    const foreignMedicationAssignee = await owner.care.medications.create
      .mutate({
        familyId: 10,
        name: "Medication with foreign assignee",
        dose: "As prescribed",
        schedule: "Daily",
        doseTimes: "08:00",
        timeZone: "America/New_York",
        assigneeId: 2,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignMedicationAssignee)).toBe("BAD_REQUEST");

    const foreignEscort = await owner.care.events.create
      .mutate({
        familyId: 10,
        title: "Appointment with foreign escort",
        kind: "appointment",
        startsAtLocal: "2026-10-29T10:00",
        timeZone: "America/New_York",
        reminderMinutes: 60,
        escortId: 2,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(foreignEscort)).toBe("BAD_REQUEST");
    expect(
      state.careEvents.some(
        row => row.title === "Appointment with foreign escort"
      )
    ).toBe(false);

    const repeatWithoutDate = await owner.care.tasks.create
      .mutate({
        familyId: 10,
        title: "Repeat without a date",
        priority: "medium",
        recurrence: "daily",
        dueAt: null,
      })
      .then(
        () => null,
        error => error
      );
    expect(getErrorCode(repeatWithoutDate)).toBe("BAD_REQUEST");

    const firstDueAt = new Date("2026-01-31T09:30:00.000Z");
    await owner.care.tasks.create.mutate({
      familyId: 10,
      title: "Monthly follow-up",
      description: "Original details",
      dueAt: firstDueAt,
      priority: "medium",
      recurrence: "monthly",
      assigneeId: 1,
      notes: "Original handoff",
    });
    const repeatingTask = state.careTasks.find(
      row => row.familyId === 10 && row.title === "Monthly follow-up"
    )!;
    const fields = {
      familyId: 10,
      taskId: repeatingTask.id,
      title: repeatingTask.title,
      description: null,
      dueAt: repeatingTask.dueAt,
      priority: repeatingTask.priority as "medium",
      assigneeId: null,
      status: "completed" as const,
      recurrence: "monthly" as const,
      notes: null,
    };
    await owner.care.tasks.update.mutate(fields);
    await owner.care.tasks.update.mutate(fields);
    const successors = state.careTasks.filter(
      row => row.generatedFromTaskId === repeatingTask.id
    );
    expect(successors).toHaveLength(1);
    expect(successors[0]?.dueAt?.toISOString()).toBe(
      "2026-02-28T09:30:00.000Z"
    );
    expect(successors[0]?.assigneeId).toBeNull();
    expect(successors[0]?.description).toBeNull();
    expect(successors[0]?.notes).toBeNull();
    expect(
      state.careTaskCompletions.filter(row => row.taskId === repeatingTask.id)
    ).toHaveLength(1);

    await owner.care.tasks.delete.mutate({
      familyId: 10,
      taskId: successors[0]!.id,
    });
    expect(state.careTasks.some(row => row.id === successors[0]!.id)).toBe(
      false
    );
  });

  it("requires ownership transfer, then anonymizes shared history while deleting the account", async () => {
    const owner = clientFor(1);
    const now = new Date("2026-10-28T12:00:00.000Z");
    const expiry = new Date("2026-11-04T12:00:00.000Z");
    state.familyMembers.push({
      id: 301,
      familyId: 10,
      userId: 3,
      role: "coordinator",
      joinedAt: now,
    });
    state.careTasks.push({
      id: 302,
      familyId: 10,
      title: "Shared task authored by Alex",
      description: null,
      dueAt: null,
      priority: "medium",
      assigneeId: 1,
      status: "completed",
      recurrence: "none",
      notes: null,
      createdBy: 1,
      completedBy: 1,
      completedAt: now,
      generatedFromTaskId: null,
      createdAt: now,
      updatedAt: now,
    });
    state.careTaskCompletions.push({
      id: 303,
      familyId: 10,
      taskId: 302,
      completedBy: 1,
      completedAt: now,
    });
    state.medications.push({
      id: 304,
      familyId: 10,
      name: "Shared prescription record",
      dose: "As prescribed",
      schedule: "As entered by family",
      doseTimes: "08:00",
      timeZone: "America/New_York",
      startDate: null,
      endDate: null,
      notes: null,
      assigneeId: 1,
      active: true,
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
    });
    state.doseConfirmations.push({
      id: 305,
      familyId: 10,
      medicationId: 304,
      doseDate: "2026-10-28",
      doseTime: "08:00",
      status: "confirmed",
      note: null,
      confirmedBy: 1,
      confirmedAt: now,
    });
    state.careEvents.push({
      id: 306,
      familyId: 10,
      title: "Shared visit",
      kind: "visit",
      startsAt: now,
      timeZone: "America/New_York",
      location: null,
      escortId: 1,
      reminderMinutes: 0,
      questions: null,
      visitNotes: "Shared note from Alex",
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
    });
    state.careNotes.push({
      id: 307,
      familyId: 10,
      kind: "handoff",
      body: "Care context from Alex",
      isConfirmedFact: false,
      createdBy: 1,
      createdAt: now,
    });
    state.familyInvitations.push({
      id: 308,
      familyId: 10,
      email: "invited@example.test",
      role: "viewer",
      tokenHash: "synthetic-token-hash",
      status: "pending",
      invitedBy: 1,
      acceptedBy: null,
      createdAt: now,
      expiresAt: expiry,
    });

    const blockedDelete = await owner.auth.deleteAccount.mutate().then(
      () => null,
      error => error
    );
    expect(getErrorCode(blockedDelete)).toBe("PRECONDITION_FAILED");
    expect(state.users.some(user => user.id === 1)).toBe(true);
    await owner.care.families.transferOwnership.mutate({
      familyId: 10,
      memberId: 301,
    });

    await expect(owner.auth.deleteAccount.mutate()).resolves.toEqual({
      success: true,
      sharedHistoryRetained: true,
    });
    const former = state.users.find(user => user.name === "Former family member")!;
    expect(state.users.some(user => user.id === 1)).toBe(false);
    expect(former.email).toBeNull();
    expect(former.openId).not.toBe("test-open-id-1");
    expect(state.familyMembers.some(member => member.userId === 1)).toBe(false);
    expect(state.families.find(family => family.id === 10)?.createdBy).toBe(former.id);
    expect(state.careTasks.find(task => task.id === 302)).toMatchObject({
      createdBy: former.id,
      completedBy: former.id,
      assigneeId: null,
    });
    expect(state.careTaskCompletions.find(row => row.id === 303)?.completedBy).toBe(former.id);
    expect(state.medications.find(row => row.id === 304)).toMatchObject({
      createdBy: former.id,
      assigneeId: null,
    });
    expect(state.doseConfirmations.find(row => row.id === 305)?.confirmedBy).toBe(former.id);
    expect(state.careEvents.find(row => row.id === 306)).toMatchObject({
      createdBy: former.id,
      escortId: null,
    });
    expect(state.careNotes.find(row => row.id === 307)?.createdBy).toBe(former.id);
    expect(state.familyInvitations.find(row => row.id === 308)).toMatchObject({
      invitedBy: former.id,
      status: "revoked",
    });
  });
});
