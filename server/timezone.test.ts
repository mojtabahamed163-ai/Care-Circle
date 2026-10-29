import { describe, expect, it } from "vitest";
import {
  canConfirmDoseAt,
  dateKeyInZone,
  formatLocalDateTimeInZone,
  resolveLocalDateTime,
  scheduledDoseInstant,
  sameLocalDateInZone,
} from "../shared/timezone";

describe("IANA time-zone conversions", () => {
  it("converts a normal local time to the matching UTC instant", () => {
    const result = resolveLocalDateTime("2026-11-01T03:30", "America/New_York");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instant.toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });

  it("rejects a wall time skipped by the spring DST change", () => {
    expect(resolveLocalDateTime("2026-03-08T02:30", "America/New_York")).toEqual({
      ok: false,
      reason: "nonexistent_local_time",
    });
  });

  it("rejects a repeated wall time during the fall DST change", () => {
    expect(resolveLocalDateTime("2026-11-01T01:30", "America/New_York")).toEqual({
      ok: false,
      reason: "ambiguous_local_time",
    });
  });

  it("rejects impossible dates and unknown IANA zones", () => {
    expect(resolveLocalDateTime("2026-02-30T10:00", "UTC")).toEqual({
      ok: false,
      reason: "invalid_datetime",
    });
    expect(resolveLocalDateTime("2026-10-28T10:00", "Not/A_Zone")).toEqual({
      ok: false,
      reason: "invalid_time_zone",
    });
  });

  it("formats and compares dates in the requested zone, not the host zone", () => {
    const instant = new Date("2026-10-28T01:30:00.000Z");
    expect(formatLocalDateTimeInZone(instant, "America/Los_Angeles")).toBe("2026-10-27T18:30");
    expect(dateKeyInZone(instant, "Asia/Tokyo")).toBe("2026-10-28");
    expect(sameLocalDateInZone(instant, new Date("2026-10-27T23:00:00.000Z"), "America/Los_Angeles")).toBe(true);
  });

  it("keeps a scheduled dose unavailable until its local time", () => {
    expect(canConfirmDoseAt("2026-10-28", "08:00", "America/New_York", new Date("2026-10-28T11:59:00.000Z"))).toBe(false);
    expect(canConfirmDoseAt("2026-10-28", "08:00", "America/New_York", new Date("2026-10-28T12:00:00.000Z"))).toBe(true);
    expect(canConfirmDoseAt("2026-10-28", "20:00", "America/New_York", new Date("2026-10-28T23:59:00.000Z"))).toBe(false);
    expect(canConfirmDoseAt("2026-10-28", "20:00", "America/New_York", new Date("2026-10-29T00:00:00.000Z"))).toBe(true);
  });

  it("keeps availability on the medication's local date across midnight", () => {
    expect(canConfirmDoseAt("2026-10-28", "23:59", "America/New_York", new Date("2026-10-29T03:59:00.000Z"))).toBe(true);
    expect(canConfirmDoseAt("2026-10-28", "23:59", "America/New_York", new Date("2026-10-29T04:00:00.000Z"))).toBe(false);
    expect(canConfirmDoseAt("2026-10-29", "00:00", "America/New_York", new Date("2026-10-29T04:00:00.000Z"))).toBe(true);
    expect(canConfirmDoseAt("2026-10-29", "08:00", "America/New_York", new Date("2026-10-29T04:00:00.000Z"))).toBe(false);
  });

  it("resolves repeated and skipped daylight-saving dose times conservatively", () => {
    expect(scheduledDoseInstant("2026-11-01", "01:30", "America/New_York")?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(scheduledDoseInstant("2026-03-08", "02:30", "America/New_York")?.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

});
