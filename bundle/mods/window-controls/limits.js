// Plan usage limits for the two usage sabers: what's left of the 5-hour and weekly windows, and how long until each
// resets. No Herdr imports, so `node --test` can load this file.
// The numbers come from ~/.claude/state/rate-limits.json, written by ~/.claude/scripts/statusline-rate-limits.js
// (Claude Code's status line command) from the `rate_limits` field Claude Code hands it.
export const LIMITS_FILE = ".claude/state/rate-limits.json";

// `resets_at` as ms: epoch seconds, epoch ms or an ISO string. Null when missing or unreadable.
export function resetMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// "2h 14m", "14m", "<1m"; a day or more as "3d 4h".
export function untilText(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// One window `{ used_percentage, resets_at }` as `{ left, until }`: whole % left (0-100) and the time to reset as text.
// Once the reset time has passed, the saved reading is from the old window, so the window is full again until the
// next reading arrives. Null when there is no reading.
export function windowLeft(w, now) {
  const used = Number(w?.used_percentage);
  if (!Number.isFinite(used)) return null;
  const reset = resetMs(w.resets_at);
  if (reset != null && reset <= now) return { left: 100, until: null };
  return { left: Math.max(0, Math.min(100, Math.round(100 - used))), until: reset != null ? untilText(reset - now) : null };
}

export function parseLimits(text, now) {
  try {
    const d = JSON.parse(text);
    return { five: windowLeft(d?.five_hour, now), week: windowLeft(d?.seven_day, now), at: Number(d?.at) || null };
  } catch {
    return null;
  }
}
