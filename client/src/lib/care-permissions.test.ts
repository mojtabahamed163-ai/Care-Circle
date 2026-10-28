import { describe, expect, it } from "vitest";
import { canCoordinateRole, canWriteRole } from "./care-permissions";

describe("family UI permissions", () => {
  it("allows writing only for recognized writable roles", () => {
    expect(canWriteRole("owner")).toBe(true);
    expect(canWriteRole("coordinator")).toBe(true);
    expect(canWriteRole("caregiver")).toBe(true);
    expect(canWriteRole("viewer")).toBe(false);
    expect(canWriteRole(undefined)).toBe(false);
    expect(canWriteRole(null)).toBe(false);
    expect(canWriteRole("unknown-role")).toBe(false);
  });

  it("allows coordinating and family export only for owner or coordinator", () => {
    expect(canCoordinateRole("owner")).toBe(true);
    expect(canCoordinateRole("coordinator")).toBe(true);
    expect(canCoordinateRole("caregiver")).toBe(false);
    expect(canCoordinateRole("viewer")).toBe(false);
    expect(canCoordinateRole(undefined)).toBe(false);
    expect(canCoordinateRole("unknown-role")).toBe(false);
  });
});
