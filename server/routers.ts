import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { isValidTimeZone } from "../shared/timezone";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { isDoseTimesValid } from "./care-utils";
import * as care from "./care-db";

const familyId = z.number().int().positive();
const isoDate = z.iso.date();
const medicationDateRangeValid = (value: {
  startDate?: string | null;
  endDate?: string | null;
}) => !value.startDate || !value.endDate || value.startDate <= value.endDate;
const medicationDateRangeError = {
  path: ["endDate"],
  message: "End date must be on or after the start date.",
};
const taskFields = {
  title: z.string().trim().min(1).max(180),
  description: z.string().max(5000).nullable().optional(),
  dueAt: z.date().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]),
  assigneeId: z.number().int().positive().nullable().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
  notes: z.string().max(5000).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
};
const medicationFields = {
  name: z.string().trim().min(1).max(180),
  dose: z.string().trim().min(1).max(180),
  schedule: z.string().trim().min(1).max(240),
  doseTimes: z.string().max(240).refine(isDoseTimesValid, {
    message: "Use up to 12 distinct HH:MM 24-hour times separated by commas.",
  }),
  timeZone: z.string().min(1).max(64).refine(isValidTimeZone, {
    message: "Choose a valid IANA time zone.",
  }),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  escalationRecipientId: z.number().int().positive().nullable().optional(),
};

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
      const result = await care.deleteAccount(ctx.user.id);
      ctx.res.clearCookie(COOKIE_NAME, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: -1,
      });
      return result;
    }),
  }),
  care: router({
    phase3: router({
      workload: protectedProcedure.input(z.object({ familyId, startDate: isoDate, endDate: isoDate }).refine(v => v.startDate <= v.endDate, { path: ["endDate"], message: "End date must be on or after the start date." }).refine(v => Date.parse(`${v.endDate}T00:00:00Z`) - Date.parse(`${v.startDate}T00:00:00Z`) <= 31 * 86400000, { path: ["endDate"], message: "Choose a range of 32 days or less." })).query(({ ctx, input }) => care.getWorkloadReport(ctx.user.id, input.familyId, input.startDate, input.endDate)),
      weeklySummary: protectedProcedure.input(z.object({ familyId, startDate: isoDate, endDate: isoDate }).refine(v => v.startDate <= v.endDate, { path: ["endDate"], message: "End date must be on or after the start date." }).refine(v => Date.parse(`${v.endDate}T00:00:00Z`) - Date.parse(`${v.startDate}T00:00:00Z`) <= 6 * 86400000, { path: ["endDate"], message: "Weekly summaries cover at most 7 days." })).query(({ ctx, input }) => care.getWeeklySummary(ctx.user.id, input.familyId, input.startDate, input.endDate)),
      digestPreference: protectedProcedure.input(z.object({ familyId })).query(({ ctx, input }) => care.getDigestPreference(ctx.user.id, input.familyId)),
      setDigestPreference: protectedProcedure.input(z.object({ familyId, enabled: z.boolean() })).mutation(({ ctx, input }) => care.setDigestPreference(ctx.user.id, input.familyId, input.enabled)),
      notificationPreferences: protectedProcedure.input(z.object({ familyId })).query(({ ctx, input }) => care.getNotificationPreferences(ctx.user.id, input.familyId)),
      setNotificationPreferences: protectedProcedure.input(z.object({ familyId, reminderOptIn: z.boolean(), escalationOptIn: z.boolean() })).mutation(({ ctx, input }) => care.setNotificationPreferences(ctx.user.id, input.familyId, input.reminderOptIn, input.escalationOptIn)),
      inbox: protectedProcedure.input(z.object({ familyId })).query(({ ctx, input }) => care.listInAppNotifications(ctx.user.id, input.familyId)),
      markNotificationRead: protectedProcedure.input(z.object({ familyId, notificationId: z.number().int().positive() })).mutation(({ ctx, input }) => care.markInAppNotificationRead(ctx.user.id, input.familyId, input.notificationId)),
      planStatus: protectedProcedure.input(z.object({ familyId })).query(({ ctx, input }) => care.getPlanStatus(ctx.user.id, input.familyId)),
    }),
    families: router({
      list: protectedProcedure.query(({ ctx }) =>
        care.listFamilies(ctx.user.id)
      ),
      export: protectedProcedure
        .input(z.object({ familyId }))
        .mutation(({ ctx, input }) =>
          care.exportFamily(ctx.user.id, input.familyId)
        ),
      create: protectedProcedure
        .input(z.object({ name: z.string().trim().min(2).max(160) }))
        .mutation(({ ctx, input }) =>
          care.createFamily(ctx.user.id, input.name)
        ),
      members: protectedProcedure
        .input(z.object({ familyId }))
        .query(({ ctx, input }) =>
          care.listMembers(ctx.user.id, input.familyId)
        ),
      changeRole: protectedProcedure
        .input(
          z.object({
            familyId,
            memberId: z.number().int().positive(),
            role: z.enum(["coordinator", "caregiver", "viewer"]),
          })
        )
        .mutation(({ ctx, input }) =>
          care.changeMemberRole(
            ctx.user.id,
            input.familyId,
            input.memberId,
            input.role
          )
        ),
      transferOwnership: protectedProcedure
        .input(z.object({ familyId, memberId: z.number().int().positive() }))
        .mutation(({ ctx, input }) =>
          care.transferOwnership(ctx.user.id, input.familyId, input.memberId)
        ),
      removeMember: protectedProcedure
        .input(z.object({ familyId, memberId: z.number().int().positive() }))
        .mutation(({ ctx, input }) =>
          care.removeMember(ctx.user.id, input.familyId, input.memberId)
        ),
      leave: protectedProcedure
        .input(z.object({ familyId }))
        .mutation(({ ctx, input }) =>
          care.leaveFamily(ctx.user.id, input.familyId)
        ),
      invitations: protectedProcedure
        .input(z.object({ familyId }))
        .query(({ ctx, input }) =>
          care.listInvitations(ctx.user.id, input.familyId)
        ),
      invite: protectedProcedure
        .input(
          z.object({
            familyId,
            email: z.string().trim().email().max(320).nullable().optional(),
            role: z.enum(["coordinator", "caregiver", "viewer"]),
          })
        )
        .mutation(({ ctx, input }) =>
          care.createInvitation(
            ctx.user.id,
            input.familyId,
            input.email ?? null,
            input.role
          )
        ),
      revokeInvitation: protectedProcedure
        .input(
          z.object({ familyId, invitationId: z.number().int().positive() })
        )
        .mutation(({ ctx, input }) =>
          care.revokeInvitation(ctx.user.id, input.familyId, input.invitationId)
        ),
    }),
    invitations: router({
      preview: publicProcedure
        .input(z.object({ token: z.string().min(32).max(128) }))
        .query(({ input }) => care.previewInvitation(input.token)),
      accept: protectedProcedure
        .input(z.object({ token: z.string().min(32).max(128) }))
        .mutation(({ ctx, input }) =>
          care.respondToInvitation(
            ctx.user.id,
            ctx.user.email,
            input.token,
            true
          )
        ),
      decline: protectedProcedure
        .input(z.object({ token: z.string().min(32).max(128) }))
        .mutation(({ ctx, input }) =>
          care.respondToInvitation(
            ctx.user.id,
            ctx.user.email,
            input.token,
            false
          )
        ),
    }),
    tasks: router({
      list: protectedProcedure
        .input(z.object({ familyId }))
        .query(({ ctx, input }) => care.listTasks(ctx.user.id, input.familyId)),
      create: protectedProcedure
        .input(z.object({ familyId, ...taskFields }))
        .mutation(({ ctx, input }) =>
          care.createTask(ctx.user.id, input.familyId, input)
        ),
      update: protectedProcedure
        .input(
          z.object({
            familyId,
            taskId: z.number().int().positive(),
            ...taskFields,
            status: z.enum(["new", "in_progress", "completed"]),
          })
        )
        .mutation(({ ctx, input }) => {
          const { familyId: id, taskId, ...fields } = input;
          return care.updateTask(ctx.user.id, id, taskId, fields);
        }),
      delete: protectedProcedure
        .input(z.object({ familyId, taskId: z.number().int().positive() }))
        .mutation(({ ctx, input }) =>
          care.deleteTask(ctx.user.id, input.familyId, input.taskId)
        ),
    }),
    collaboration: router({
      requests: protectedProcedure.input(z.object({ familyId })).query(({ ctx, input }) => care.listCollaborationRequests(ctx.user.id, input.familyId)),
      request: protectedProcedure.input(z.object({ familyId, taskId: z.number().int().positive(), targetId: z.number().int().positive(), kind: z.enum(["help", "swap"]) })).mutation(({ ctx, input }) => care.requestTaskCollaboration(ctx.user.id, input.familyId, input.taskId, input.targetId, input.kind)),
      respond: protectedProcedure.input(z.object({ familyId, requestId: z.number().int().positive(), accept: z.boolean() })).mutation(({ ctx, input }) => care.respondTaskCollaboration(ctx.user.id, input.familyId, input.requestId, input.accept)),
    }),
    absences: router({
      list: protectedProcedure.input(z.object({ familyId })).query(({ ctx, input }) => care.listAbsences(ctx.user.id, input.familyId)),
      create: protectedProcedure.input(z.object({ familyId, memberId: z.number().int().positive(), startDate: isoDate, endDate: isoDate, note: z.string().trim().max(1000).nullable().optional() })).mutation(({ ctx, input }) => care.createAbsence(ctx.user.id, input.familyId, input)),
    }),
    audit: router({
      list: protectedProcedure.input(z.object({ familyId })).query(({ ctx, input }) => care.listCareAudit(ctx.user.id, input.familyId)),
    }),
    handoffs: router({
      list: protectedProcedure.input(z.object({ familyId })).query(({ ctx, input }) => care.listCareHandoffs(ctx.user.id, input.familyId)),
      create: protectedProcedure.input(z.object({ familyId, eventId: z.number().int().positive(), recipientId: z.number().int().positive(), context: z.string().trim().min(1).max(8000), pendingTaskIds: z.array(z.number().int().positive()).max(100) })).mutation(({ ctx, input }) => care.createCareHandoff(ctx.user.id, input.familyId, input)),
    }),
    medications: router({
      list: protectedProcedure
        .input(z.object({ familyId }))
        .query(({ ctx, input }) =>
          care.listMedications(ctx.user.id, input.familyId)
        ),
      create: protectedProcedure
        .input(
          z
            .object({ familyId, ...medicationFields })
            .refine(medicationDateRangeValid, medicationDateRangeError)
        )
        .mutation(({ ctx, input }) =>
          care.createMedication(ctx.user.id, input.familyId, input)
        ),
      update: protectedProcedure
        .input(
          z
            .object({
              familyId,
              medicationId: z.number().int().positive(),
              ...medicationFields,
              active: z.boolean(),
            })
            .refine(medicationDateRangeValid, medicationDateRangeError)
        )
        .mutation(({ ctx, input }) => {
          const { familyId: id, medicationId, ...fields } = input;
          return care.updateMedication(ctx.user.id, id, medicationId, fields);
        }),
      confirm: protectedProcedure
        .input(
          z.object({
            familyId,
            medicationId: z.number().int().positive(),
            doseDate: isoDate,
            doseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^once$/),
            note: z.string().max(2000).nullable().optional(),
          })
        )
        .mutation(({ ctx, input }) =>
          care.confirmDose(
            ctx.user.id,
            input.familyId,
            input.medicationId,
            input.doseDate,
            input.doseTime,
            input.note
          )
        ),
    }),
    events: router({
      list: protectedProcedure
        .input(z.object({ familyId }))
        .query(({ ctx, input }) =>
          care.listEvents(ctx.user.id, input.familyId)
        ),
      create: protectedProcedure
        .input(
          z.object({
            familyId,
            title: z.string().trim().min(1).max(180),
            kind: z.enum(["appointment", "visit"]),
            startsAtLocal: z.string().min(16).max(16),
            timeZone: z.string().min(1).max(64).refine(isValidTimeZone, {
              message: "Choose a valid IANA time zone.",
            }),
            location: z.string().max(240).nullable().optional(),
            escortId: z.number().int().positive().nullable().optional(),
            reminderMinutes: z.number().int().min(0).max(10080),
            questions: z.string().max(5000).nullable().optional(),
            visitNotes: z.string().max(5000).nullable().optional(),
          })
        )
        .mutation(({ ctx, input }) =>
          care.createEvent(ctx.user.id, input.familyId, input)
        ),
      update: protectedProcedure
        .input(
          z.object({
            familyId,
            eventId: z.number().int().positive(),
            title: z.string().trim().min(1).max(180),
            kind: z.enum(["appointment", "visit"]),
            startsAtLocal: z.string().min(16).max(16),
            timeZone: z.string().min(1).max(64).refine(isValidTimeZone, {
              message: "Choose a valid IANA time zone.",
            }),
            location: z.string().max(240).nullable().optional(),
            escortId: z.number().int().positive().nullable().optional(),
            reminderMinutes: z.number().int().min(0).max(10080),
            questions: z.string().max(5000).nullable().optional(),
            visitNotes: z.string().max(5000).nullable().optional(),
          })
        )
        .mutation(({ ctx, input }) => {
          const { familyId: id, eventId, ...fields } = input;
          return care.updateEvent(ctx.user.id, id, eventId, fields);
        }),
      delete: protectedProcedure
        .input(z.object({ familyId, eventId: z.number().int().positive() }))
        .mutation(({ ctx, input }) =>
          care.deleteEvent(ctx.user.id, input.familyId, input.eventId)
        ),
    }),
    notes: router({
      list: protectedProcedure
        .input(z.object({ familyId }))
        .query(({ ctx, input }) =>
          care.listCareNotes(ctx.user.id, input.familyId)
        ),
      create: protectedProcedure
        .input(
          z.object({
            familyId,
            kind: z.enum([
              "update",
              "visit_note",
              "question",
              "handoff",
              "need",
            ]),
            body: z.string().trim().min(1).max(8000),
            isConfirmedFact: z.boolean(),
          })
        )
        .mutation(({ ctx, input }) =>
          care.createCareNote(ctx.user.id, input.familyId, input)
        ),
    }),
    householdNeeds: router({
      list: protectedProcedure
        .input(z.object({ familyId }))
        .query(({ ctx, input }) =>
          care.listHouseholdNeeds(ctx.user.id, input.familyId)
        ),
      create: protectedProcedure
        .input(
          z.object({
            familyId,
            name: z.string().trim().min(1).max(180),
            quantity: z.string().trim().max(120).nullable().optional(),
            priority: z.enum(["low", "medium", "high"]),
            buyerId: z.number().int().positive().nullable().optional(),
          })
        )
        .mutation(({ ctx, input }) =>
          care.createHouseholdNeed(ctx.user.id, input.familyId, input)
        ),
      update: protectedProcedure
        .input(
          z.object({
            familyId,
            needId: z.number().int().positive(),
            name: z.string().trim().min(1).max(180),
            quantity: z.string().trim().max(120).nullable().optional(),
            priority: z.enum(["low", "medium", "high"]),
            buyerId: z.number().int().positive().nullable().optional(),
            completed: z.boolean(),
          })
        )
        .mutation(({ ctx, input }) => {
          const { familyId: id, needId, ...fields } = input;
          return care.updateHouseholdNeed(ctx.user.id, id, needId, fields);
        }),
      delete: protectedProcedure
        .input(z.object({ familyId, needId: z.number().int().positive() }))
        .mutation(({ ctx, input }) =>
          care.deleteHouseholdNeed(ctx.user.id, input.familyId, input.needId)
        ),
    }),
    importantContacts: router({
      list: protectedProcedure
        .input(z.object({ familyId }))
        .query(({ ctx, input }) =>
          care.listImportantContacts(ctx.user.id, input.familyId)
        ),
      create: protectedProcedure
        .input(
          z.object({
            familyId,
            kind: z.enum(["provider", "clinic", "family", "emergency"]),
            name: z.string().trim().min(1).max(180),
            organization: z.string().trim().max(180).nullable().optional(),
            phone: z.string().trim().max(80).nullable().optional(),
            email: z.string().trim().email().max(320).nullable().optional(),
            notes: z.string().trim().max(1000).nullable().optional(),
          })
        )
        .mutation(({ ctx, input }) =>
          care.createImportantContact(ctx.user.id, input.familyId, input)
        ),
      update: protectedProcedure
        .input(
          z.object({
            familyId,
            contactId: z.number().int().positive(),
            kind: z.enum(["provider", "clinic", "family", "emergency"]),
            name: z.string().trim().min(1).max(180),
            organization: z.string().trim().max(180).nullable().optional(),
            phone: z.string().trim().max(80).nullable().optional(),
            email: z.string().trim().email().max(320).nullable().optional(),
            notes: z.string().trim().max(1000).nullable().optional(),
          })
        )
        .mutation(({ ctx, input }) => {
          const { familyId: id, contactId, ...fields } = input;
          return care.updateImportantContact(
            ctx.user.id,
            id,
            contactId,
            fields
          );
        }),
      delete: protectedProcedure
        .input(z.object({ familyId, contactId: z.number().int().positive() }))
        .mutation(({ ctx, input }) =>
          care.deleteImportantContact(
            ctx.user.id,
            input.familyId,
            input.contactId
          )
        ),
    }),
  }),
});

export type AppRouter = typeof appRouter;
