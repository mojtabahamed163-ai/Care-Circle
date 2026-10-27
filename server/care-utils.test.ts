import { describe, expect, it } from "vitest";
import { isOverdue, nextRecurringDueDate } from "./care-utils";

describe("recurring care task scheduling", () => {
  it("advances daily and weekly due dates without changing the time", () => {
    const due = new Date("2026-04-02T09:30:00.000Z");
    expect(nextRecurringDueDate(due, "daily")?.toISOString()).toBe(
      "2026-04-03T09:30:00.000Z"
    );
    expect(nextRecurringDueDate(due, "weekly")?.toISOString()).toBe(
      "2026-04-09T09:30:00.000Z"
    );
  });

  it("clamps a monthly task to the final day of a shorter month", () => {
    const due = new Date("2026-01-31T08:00:00.000Z");
    expect(nextRecurringDueDate(due, "monthly")?.toISOString()).toBe(
      "2026-02-28T08:00:00.000Z"
    );
  });

  it("does not invent a next date for a non-recurring task", () => {
    expect(
      nextRecurringDueDate(new Date("2026-04-02T09:30:00.000Z"), "none")
    ).toBeNull();
  });
});

describe("task overdue state", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  it("marks only past-due, incomplete work as overdue", () => {
    expect(isOverdue(new Date("2026-10-27T11:59:00.000Z"), "new", now)).toBe(
      true
    );
    expect(
      isOverdue(new Date("2026-10-27T11:59:00.000Z"), "completed", now)
    ).toBe(false);
    expect(
      isOverdue(new Date("2026-10-27T12:01:00.000Z"), "in_progress", now)
    ).toBe(false);
    expect(isOverdue(null, "new", now)).toBe(false);
  });
});
