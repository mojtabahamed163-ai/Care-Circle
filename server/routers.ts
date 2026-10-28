import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
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
};
const medicationFields = {
  name: z.string().trim().min(1).max(180),
  dose: z.string().trim().min(1).max(180),
  schedule: z.string().trim().min(1).max(240),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
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
  }),
  care: router({
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
    medications: router({
      list: protectedProcedure
        .input(
          z.object({
            familyId,
            doseDate: isoDate,
          })
        )
        .query(({ ctx, input }) =>
          care.listMedications(ctx.user.id, input.familyId, input.doseDate)
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
            note: z.string().max(2000).nullable().optional(),
          })
        )
        .mutation(({ ctx, input }) =>
          care.confirmDose(
            ctx.user.id,
            input.familyId,
            input.medicationId,
            input.doseDate,
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
            startsAt: z.date(),
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
  }),
});

export type AppRouter = typeof appRouter;
