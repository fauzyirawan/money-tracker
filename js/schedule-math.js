/* schedule-math.js: menghitung tanggal jatuh tempo jadwal, sama persis dengan
   backend/Scheduler.gs. Dipakai untuk menandai kalender di halaman Terjadwal. */

import { addDays, daysBetween, toDate, toIso } from "./stats.js";

function weekdayOf(iso) {
  return toDate(iso).getUTCDay();
}

function clampedDate(year, month, day) {
  const date = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return toIso(date);
}

function parseWeekdays(text) {
  return String(text || "")
    .split(",")
    .filter((part) => part !== "")
    .map(Number)
    .sort();
}

function anchorDay(schedule) {
  return schedule.dayOfMonth || toDate(schedule.startDate).getUTCDate();
}

function mondayOf(iso) {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7));
}

function nextWeekly(schedule, from) {
  const weekdays = parseWeekdays(schedule.weekdays);
  const allowed = weekdays.length ? weekdays : [weekdayOf(schedule.startDate)];
  const step = schedule.interval || 1;
  const startWeek = mondayOf(schedule.startDate);
  for (let offset = 1; offset <= 7 * step + 7; offset += 1) {
    const candidate = addDays(from, offset);
    const weeks = Math.floor(daysBetween(startWeek, candidate) / 7);
    if (weeks % step === 0 && allowed.includes(weekdayOf(candidate))) return candidate;
  }
  return null;
}

export function computeNextDate(schedule, from) {
  const date = toDate(from);
  const step = schedule.interval || 1;
  switch (schedule.frequency) {
    case "DAILY":
    case "EVERY_N_DAYS":
      return addDays(from, step);
    case "WEEKLY":
      return nextWeekly(schedule, from);
    case "MONTHLY":
      return clampedDate(date.getUTCFullYear(), date.getUTCMonth() + step, anchorDay(schedule));
    case "YEARLY": {
      const start = toDate(schedule.startDate);
      return clampedDate(date.getUTCFullYear() + step, start.getUTCMonth(), start.getUTCDate());
    }
    default:
      return null;
  }
}

/* Semua jatuh tempo dalam rentang, dimulai dari tanggal berikutnya yang tersimpan. */
export function occurrences(schedule, from, to, limit = 62) {
  const dates = [];
  if (!schedule.active || !schedule.nextDate) return dates;
  let date = schedule.nextDate;
  let runs = schedule.runCount || 0;
  while (date && date <= to && dates.length < limit) {
    if (schedule.maxRuns && runs >= schedule.maxRuns) break;
    if (schedule.endDate && date > schedule.endDate) break;
    if (date >= from) dates.push(date);
    runs += 1;
    date = computeNextDate(schedule, date);
  }
  return dates;
}
