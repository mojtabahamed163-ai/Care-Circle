const writeRoles = new Set(["owner", "coordinator", "caregiver"]);
const coordinatorRoles = new Set(["owner", "coordinator"]);

export function canWriteRole(role: unknown): boolean {
  return typeof role === "string" && writeRoles.has(role);
}

export function canCoordinateRole(role: unknown): boolean {
  return typeof role === "string" && coordinatorRoles.has(role);
}
