import { dowOf } from "@/lib/date";

/**
 * Iterate every ISO date string between fromISO and toISO (inclusive),
 * skipping Saturdays/Sundays and any date in the holidays set.
 */
export function* iterateWorkingDays(
  fromISO: string,
  toISO: string,
  holidays: ReadonlySet<string>,
): Generator<string> {
  if (toISO < fromISO) return;
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const dow = dowOf(iso);
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(iso)) continue;
    yield iso;
  }
}

export function countWorkingDays(
  fromISO: string,
  toISO: string,
  holidays: ReadonlySet<string>,
): number {
  let n = 0;
  for (const _date of iterateWorkingDays(fromISO, toISO, holidays)) {
    void _date;
    n++;
  }
  return n;
}
