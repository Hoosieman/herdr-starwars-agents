// Pure logic for the Saber meters: prompt-cache countdown (Oscar), context % (Cookie), session time (Count). No Herdr
// imports, so `node --test` can load this file. saber-spaces keeps an identical copy: edit both together.
export const TTL_MS = 60 * 60 * 1000;
export const SOON_MS = 15 * 60 * 1000;
export const URGENT_MS = 5 * 60 * 1000;
// Same thresholds as ~/.claude/statusline-command.py severity_color().
export const CONTEXT_YELLOW = 50;
export const CONTEXT_ORANGE = 70;
export const CONTEXT_RED = 90;

// One switch for the glyphs: false falls back to plain characters if emoji don't render in the UI.
export const EMOJI = true;
export const GLYPH = EMOJI ? { oscar: "\u{1F5D1}", cookie: "\u{1F36A}", count: "\u{1F9DB}" } : { oscar: "⌂", cookie: "●", count: "⏱" };

// Time left on the prompt cache, from the transcript's last write (ms). Negative once expired.
export const remaining = (last, now) => last + TTL_MS - now;

// "47m" with 5 minutes or more left, "m:ss" under that, "cold" once it has expired.
export function formatCountdown(ms) {
  if (!(ms > 0)) return "cold";
  if (ms >= URGENT_MS) return `${Math.floor(ms / 60000)}m`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// A `theme()` color name for the time left: green over 15 min, yellow 5 to 15, orange under 5, dim once cold.
export function countdownTone(ms) {
  if (!(ms > 0)) return "dim";
  if (ms > SOON_MS) return "ansi2";
  if (ms >= URGENT_MS) return "ansi3";
  return "blocked";
}


// Matches the statusline: green below 50%, yellow from 50, orange from 70, red from 90.
export function contextTone(pct) {
  if (pct >= CONTEXT_RED) return "ansi1";
  if (pct >= CONTEXT_ORANGE) return "blocked";
  if (pct >= CONTEXT_YELLOW) return "ansi3";
  return "ansi2";
}

// "2h 14m", "14m", "1m" (under a minute too); a day or more as "1d 3h".
export function formatSession(ms) {
  const m = Math.floor(Math.max(0, ms ?? 0) / 60000);
  if (m < 1) return "1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// The countdown, tone and text for one entry `{ last }`, or null without a transcript time.
export function countdownOf(entry, now) {
  if (!Number.isFinite(entry?.last)) return null;
  const ms = remaining(entry.last, now);
  return { ms, text: formatCountdown(ms), tone: countdownTone(ms) };
}

// Several agents in one space: the soonest-expiring countdown that isn't cold (else the freshest cold one), and the
// highest context %. `entries` are `{ last, pct }`. Null when there's nothing to show.
export function aggregateSpace(entries, now) {
  const list = (entries ?? []).filter((e) => e && (Number.isFinite(e.last) || Number.isFinite(e.pct)));
  if (!list.length) return null;
  const lasts = list.filter((e) => Number.isFinite(e.last));
  const live = lasts.filter((e) => remaining(e.last, now) > 0).sort((a, b) => a.last - b.last);
  const pick = live[0] ?? lasts.sort((a, b) => b.last - a.last)[0] ?? null;
  const pcts = list.map((e) => e.pct).filter(Number.isFinite);
  const toks = list.map((e) => e.tokens).filter(Number.isFinite);
  return { countdown: pick ? countdownOf(pick, now) : null, pct: pcts.length ? Math.max(...pcts) : null, tokens: toks.length ? Math.max(...toks) : null };
}

// Tick every second only while a shown countdown is under 5 minutes; every 30 s otherwise.
export const SLOW_TICK_MS = 30000;
export const FAST_TICK_MS = 1000;
export function tickMs(entries, now) {
  let next = SLOW_TICK_MS;
  for (const e of entries ?? []) {
    if (!Number.isFinite(e?.last)) continue;
    const r = remaining(e.last, now);
    if (r <= 0) continue;
    // Under 5 minutes: every second. Above: slow, but never past the moment the countdown turns urgent.
    next = Math.min(next, r < URGENT_MS ? FAST_TICK_MS : r - URGENT_MS + 50);
  }
  return Math.max(FAST_TICK_MS, next);
}
