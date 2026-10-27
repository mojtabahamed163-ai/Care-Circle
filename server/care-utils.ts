export type Recurrence = "none" | "daily" | "weekly" | "monthly";

/** Advance a recurring task in UTC while keeping its time and clamping month-end dates. */
export function nextRecurringDueDate(
  dueAt: Date,
  recurrence: Recurrence
): Date | null {
  if (recurrence === "none") return null;
  const next = new Date(dueAt);
  if (recurrence === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (recurrence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (recurrence === "monthly") {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
    ).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  }
  return next;
}

export function isOverdue(
  dueAt: Date | null,
  status: string,
  now: Date
): boolean {
  return !!dueAt && status !== "completed" && dueAt.getTime() < now.getTime();
}
