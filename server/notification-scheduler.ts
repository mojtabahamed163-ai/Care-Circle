import { scheduledDoseInstant } from "../shared/timezone";

export type NotificationKind =
  | "due_reminder"
  | "unconfirmed_10m"
  | "escalation_20m";
export type PlannedDoseNotification = {
  eventKey: string;
  kind: NotificationKind;
  recipientId: number;
  doseDate: string;
  doseTime: string;
  scheduledAt: Date;
  message: string;
};

/** Pure planning function: no timers, storage, or network access. */
export function planDoseNotifications(input: {
  medicationId: number;
  medicationName: string;
  doseDate: string;
  doseTime: string;
  timeZone: string;
  now: Date;
  assigneeId: number | null;
  assigneeIsCurrentMember: boolean;
  assigneeReminderOptIn: boolean;
  escalationRecipientId: number | null;
  escalationRecipientIsCurrentMember: boolean;
  escalationRecipientOptIn: boolean;
  alreadyConfirmed: boolean;
}): PlannedDoseNotification[] {
  if (input.alreadyConfirmed || input.doseTime === "once") return [];
  const dueAt = scheduledDoseInstant(
    input.doseDate,
    input.doseTime,
    input.timeZone
  );
  if (!dueAt || input.now.getTime() < dueAt.getTime()) return [];
  const steps: {
    offset: number;
    kind: NotificationKind;
    recipientId: number | null;
    allowed: boolean;
  }[] = [
    {
      offset: 0,
      kind: "due_reminder",
      recipientId: input.assigneeId,
      allowed: input.assigneeIsCurrentMember && input.assigneeReminderOptIn,
    },
    {
      offset: 10,
      kind: "unconfirmed_10m",
      recipientId: input.assigneeId,
      allowed: input.assigneeIsCurrentMember && input.assigneeReminderOptIn,
    },
    {
      offset: 20,
      kind: "escalation_20m",
      recipientId: input.escalationRecipientId,
      allowed:
        input.escalationRecipientIsCurrentMember &&
        input.escalationRecipientOptIn,
    },
  ];
  return steps.flatMap(step => {
    const scheduledAt = new Date(dueAt.getTime() + step.offset * 60_000);
    if (
      !step.allowed ||
      !step.recipientId ||
      input.now.getTime() < scheduledAt.getTime()
    )
      return [];
    const { doseDate, doseTime, medicationId, medicationName } = input;
    const message =
      step.kind === "due_reminder"
        ? `${medicationName}: scheduled dose at ${doseTime}. Please record its status.`
        : step.kind === "unconfirmed_10m"
          ? `${medicationName}: لم يتم تأكيد الجرعة حتى الآن (${doseDate} ${doseTime}).`
          : `${medicationName}: لم يتم تأكيد الجرعة حتى الآن (${doseDate} ${doseTime}); family follow-up requested.`;
    return [
      {
        eventKey: `dose:${medicationId}:${doseDate}:${doseTime}:${step.kind}:${step.recipientId}`,
        kind: step.kind,
        recipientId: step.recipientId,
        doseDate,
        doseTime,
        scheduledAt,
        message,
      },
    ];
  });
}
