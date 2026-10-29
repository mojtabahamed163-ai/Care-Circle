import { describe, expect, it } from "vitest";
import { planDoseNotifications } from "./notification-scheduler";

const base = {
  medicationId: 44,
  medicationName: "Example medicine",
  doseDate: "2026-11-01",
  doseTime: "01:30",
  timeZone: "America/New_York",
  assigneeId: 7,
  assigneeIsCurrentMember: true,
  assigneeReminderOptIn: true,
  escalationRecipientId: 8,
  escalationRecipientIsCurrentMember: true,
  escalationRecipientOptIn: true,
  alreadyConfirmed: false,
};
const instant = (value: string) => new Date(value);

describe("dose notification planner", () => {
  it("uses the approved IANA/DST resolver and makes due/+10/+20 stages eligible at thresholds", () => {
    // On fall-back day, 01:30 is the first occurrence (05:30Z), per shared timezone policy.
    expect(
      planDoseNotifications({ ...base, now: instant("2026-11-01T05:29:59Z") })
    ).toEqual([]);
    expect(
      planDoseNotifications({
        ...base,
        now: instant("2026-11-01T05:30:00Z"),
      }).map(x => x.kind)
    ).toEqual(["due_reminder"]);
    expect(
      planDoseNotifications({
        ...base,
        now: instant("2026-11-01T05:40:00Z"),
      }).map(x => x.kind)
    ).toEqual(["due_reminder", "unconfirmed_10m"]);
    expect(
      planDoseNotifications({
        ...base,
        now: instant("2026-11-01T05:50:00Z"),
      }).map(x => x.kind)
    ).toEqual(["due_reminder", "unconfirmed_10m", "escalation_20m"]);
  });
  it("requires current membership and explicit opt-in for each recipient", () => {
    const output = planDoseNotifications({
      ...base,
      now: instant("2026-11-01T05:50:00Z"),
      assigneeReminderOptIn: false,
    });
    expect(output.map(x => x.kind)).toEqual(["escalation_20m"]);
    expect(
      planDoseNotifications({
        ...base,
        now: instant("2026-11-01T05:50:00Z"),
        escalationRecipientOptIn: false,
      })
    ).toHaveLength(2);
    expect(
      planDoseNotifications({
        ...base,
        now: instant("2026-11-01T05:50:00Z"),
        escalationRecipientIsCurrentMember: false,
      }).map(x => x.kind)
    ).toEqual(["due_reminder", "unconfirmed_10m"]);
  });
  it("suppresses confirmed doses and uses stable unique keys across retries/restarts", () => {
    const input = { ...base, now: instant("2026-11-01T05:50:00Z") };
    expect(planDoseNotifications({ ...input, alreadyConfirmed: true })).toEqual(
      []
    );
    const first = planDoseNotifications(input);
    const second = planDoseNotifications(input);
    expect(second.map(x => x.eventKey)).toEqual(first.map(x => x.eventKey));
    expect(new Set(first.map(x => x.eventKey)).size).toBe(first.length);
  });
  it("uses precise not-confirmed wording and does not schedule legacy untimed doses", () => {
    const result = planDoseNotifications({
      ...base,
      now: instant("2026-11-01T05:50:00Z"),
    });
    expect(
      result
        .filter(x => x.kind !== "due_reminder")
        .every(x => x.message.includes("لم يتم تأكيد الجرعة حتى الآن"))
    ).toBe(true);
    expect(
      planDoseNotifications({
        ...base,
        doseTime: "once",
        now: instant("2026-11-01T05:50:00Z"),
      })
    ).toEqual([]);
  });
});
