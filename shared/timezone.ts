export type LocalDateTimeResolution =
  | { ok: true; instant: Date }
  | {
      ok: false;
      reason:
        | "invalid_datetime"
        | "invalid_time_zone"
        | "nonexistent_local_time"
        | "ambiguous_local_time";
    };

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseLocalParts(value: string): DateTimeParts | null {
  const match = localDateTimePattern.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
  };
  const roundTrip = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  );
  if (
    parts.year < 1000 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    roundTrip.getUTCFullYear() !== parts.year ||
    roundTrip.getUTCMonth() + 1 !== parts.month ||
    roundTrip.getUTCDate() !== parts.day
  )
    return null;
  return parts;
}

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function partsAt(instant: Date, timeZone: string): DateTimeParts {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)])
  ) as Record<string, number>;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function sameParts(left: DateTimeParts, right: DateTimeParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function offsetsNearWallClock(wallClockMs: number, timeZone: string) {
  const offsets = new Set<number>();
  const minuteMs = 60_000;
  for (const hours of [-48, -36, -24, -12, 0, 12, 24, 36, 48]) {
    const sampleMs = wallClockMs + hours * 60 * minuteMs;
    const zoned = partsAt(new Date(sampleMs), timeZone);
    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute
    );
    offsets.add(zonedAsUtc - sampleMs);
  }
  return [...offsets];
}

function instantsForParts(parts: DateTimeParts, timeZone: string, offsets: number[]) {
  const wallClockMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
  return [...new Set(
    offsets
      .map(offset => wallClockMs - offset)
      .filter(candidate => sameParts(partsAt(new Date(candidate), timeZone), parts))
  )].sort((left, right) => left - right);
}

export function isValidTimeZone(timeZone: string) {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    formatter(timeZone).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** Convert a wall-clock value entered for an IANA time zone into an instant.
 * Times skipped by the spring DST transition and repeated during the fall
 * transition are rejected rather than silently shifted or guessed.
 */
export function resolveLocalDateTime(
  value: string,
  timeZone: string
): LocalDateTimeResolution {
  const parts = parseLocalParts(value);
  if (!parts) return { ok: false, reason: "invalid_datetime" };
  if (!isValidTimeZone(timeZone))
    return { ok: false, reason: "invalid_time_zone" };

  const wallClockMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
  const matches = instantsForParts(
    parts,
    timeZone,
    offsetsNearWallClock(wallClockMs, timeZone)
  );
  if (matches.length === 0)
    return { ok: false, reason: "nonexistent_local_time" };
  if (matches.length > 1)
    return { ok: false, reason: "ambiguous_local_time" };
  return { ok: true, instant: new Date(matches[0]!) };
}

/** Resolve a recurring wall-clock dose time. A repeated fall-back time uses
 * its first occurrence; a skipped spring-forward time becomes due at the
 * first real local minute after the gap, rather than being moved earlier.
 */
export function scheduledDoseInstant(
  doseDate: string,
  doseTime: string,
  timeZone: string
): Date | null {
  const parts = parseLocalParts(`${doseDate}T${doseTime}`);
  if (!parts || !isValidTimeZone(timeZone)) return null;
  const baseMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
  const offsets = offsetsNearWallClock(baseMs, timeZone);
  const minuteMs = 60_000;
  for (let shift = 0; shift <= 24 * 60; shift += 1) {
    const wallClock = new Date(baseMs + shift * minuteMs);
    const shiftedParts = {
      year: wallClock.getUTCFullYear(),
      month: wallClock.getUTCMonth() + 1,
      day: wallClock.getUTCDate(),
      hour: wallClock.getUTCHours(),
      minute: wallClock.getUTCMinutes(),
    };
    const matches = instantsForParts(shiftedParts, timeZone, offsets);
    if (matches.length) return new Date(matches[0]!);
  }
  return null;
}

/** True only on the medication's current local date and once its scheduled
 * instant has arrived. Legacy once-daily records have no specified clock time.
 */
export function canConfirmDoseAt(
  doseDate: string,
  doseTime: string,
  timeZone: string,
  now: Date
) {
  if (!Number.isFinite(now.getTime()) || !isValidTimeZone(timeZone)) return false;
  if (dateKeyInZone(now, timeZone) !== doseDate) return false;
  if (doseTime === "once") return true;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(doseTime)) return false;
  const scheduledAt = scheduledDoseInstant(doseDate, doseTime, timeZone);
  return !!scheduledAt && now.getTime() >= scheduledAt.getTime();
}

export function formatLocalDateTimeInZone(instant: Date, timeZone: string) {
  const parts = partsAt(instant, isValidTimeZone(timeZone) ? timeZone : "UTC");
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function dateKeyInZone(instant: Date, timeZone: string) {
  return formatLocalDateTimeInZone(instant, timeZone).slice(0, 10);
}

export function sameLocalDateInZone(left: Date, right: Date, timeZone: string) {
  return dateKeyInZone(left, timeZone) === dateKeyInZone(right, timeZone);
}
