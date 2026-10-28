export type Recurrence = "none" | "daily" | "weekly" | "monthly";

/** Normalize an optional comma-separated list of 24-hour local dose times. */
export function normalizeDoseTimes(value: string | null | undefined): string[] {
  const text = value?.trim() ?? "";
  if (!text) return [];
  const times = text.split(",").map(time => time.trim());
  if (
    times.length > 12 ||
    times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) ||
    new Set(times).size !== times.length
  )
    throw new Error("Enter up to 12 distinct dose times in HH:MM 24-hour format.");
  return [...times].sort();
}

export function storedDoseTimes(value: string | null | undefined): string[] {
  const times = normalizeDoseTimes(value);
  return times.length ? times : ["once"];
}

export function isDoseTimesValid(value: string) {
  try {
    normalizeDoseTimes(value);
    return true;
  } catch {
    return false;
  }
}

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
