// Saber look for the sidebar: the context bar as an energy blade with a small hilt, and the state marks.
// saber-agents keeps an identical copy: edit both together.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

// Hilt styles, all 30 px long so blades line up. Each agent keeps one, picked from its address.
const HILTS = [
  // Classic: grey pommel, dark ridged grip, red button, plain metal emitter.
  { pommel: "#4a4f57", grip: "#2b2e34", ridge: "#8a919b", metal: "#b9bfc7", lip: "#1e2025", button: "#ff4a4a", ridges: 6 },
  // Chrome: bright silver body, black ridges, gold button.
  { pommel: "#d5d9de", grip: "#a9afb6", ridge: "#1f2226", metal: "#e6e9ec", lip: "#3a3f45", button: "#e8b931", ridges: 5 },
  // Bronze: warm brass body, dark bands, blue button.
  { pommel: "#8a5a2b", grip: "#b9873f", ridge: "#4b3017", metal: "#d9b36a", lip: "#5a3a1a", button: "#4aa3ff", ridges: 4 },
  // Ivory: pale grip, silver ridges, green button, long emitter.
  { pommel: "#9aa0a6", grip: "#e4dfd2", ridge: "#9aa0a6", metal: "#c9ced4", lip: "#5b6168", button: "#56c271", ridges: 4, long: true },
];

// A stable pick per agent: the same address always gets the same hilt.
export function hiltFor(key) {
  const s = String(key ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % HILTS.length;
}

// A slim hilt, 30 px long: pommel, ridged grip with a small button, metal emitter, emitter lip.
function hilt(style = 0) {
  const H = HILTS[style] ?? HILTS[0];
  const ridge = () => div().w(1).h(4).rounded(0.5).bg(H.ridge);
  const marks = [];
  const half = Math.floor(H.ridges / 2);
  for (let i = 0; i < H.ridges; i++) {
    if (i === half) marks.push(div().size(2).rounded_full().bg(H.button));
    marks.push(ridge());
  }
  const gripW = H.long ? 15 : 18;
  const metalW = H.long ? 10 : H.guard ? 5 : 7;
  return h_flex().flex_none().items_center()
    .child(div().w(3).h(5).rounded_l(1).bg(H.pommel))
    .child(h_flex().w(gripW).h(4).bg(H.grip).justify_around().items_center().children(marks))
    .child(div().w(metalW).h(6).rounded_r(1).bg(H.metal))
    .when(Boolean(H.guard), (el) => el.child(div().w(2).h(9).rounded(1).bg(H.ridge)))
    .child(div().w(2).h(4).bg(H.lip));
}

// The blade, lit to `pct`% of the row: a soft outer glow, a coloured edge, and a white-hot core that stops
// just short of the tip so the tip shows the colour. The unlit rest is a faint track.
// `lit` false (a quiet space) draws the blade off, just the hilt and the track.
// A full blade (100%) reaches this share of the room after the hilt; everything below scales with it.
const BLADE_MAX = 0.85;

// `opts.reach`, 0 to 1, is how far the blade has extended from the hilt: an igniting blade is drawn with it
// rising over a few hundred ms (the caller steps it), a settled one at 1. `opts.hum` makes it pulse.
export function saberBar(t, pct, color, lit = true, style = 0, opts = {}) {
  const reach = Math.max(0, Math.min(1, opts.reach ?? 1));
  const w = `${Math.max(3, Math.min(100, pct)) * BLADE_MAX * reach}%`;
  const blade = div().flex_1().min_w(0).h(10).relative()
    .child(div().absolute().left(0).w(`${BLADE_MAX * 100}%`).top(4.5).h(1).rounded_full().bg(t.input).opacity(0.4));
  if (!lit) return h_flex().flex_1().min_w(0).items_center().child(hilt(style)).child(blade);
  // `opts.pulse` (awaiting orders): the whole blade fades in and out, in step with the blocked mark.
  const beam = div().absolute().left(0).top(0).h(10).w(w)
    .when(Boolean(opts.pulse), (el) => el.loop("opacity", { from: 1, to: 0.3, period: 1400 }))
    // A humming blade (an agent at work) glows in a slow pulse: the outer glow swells and the coloured core
    // brightens with it, in step; the white core stays steady. Otherwise the blade is still.
    // The glow layers start a few px back over the emitter, so the blade bleeds onto the hilt instead of
    // meeting it at a hard edge; the core starts at the emitter.
    .child(div().absolute().left(-6).right(0).top(0).h(10).rounded(5).bg(color).opacity(0.18)
      .when(Boolean(opts.hum), (el) => el.loop("opacity", { from: 0.14, to: 0.42, period: 2200 })))
    .child(div().absolute().left(-3).right(0).top(1.5).h(7).rounded(3.5).bg(color).opacity(0.45)
      .when(Boolean(opts.hum), (el) => el.loop("opacity", { from: 0.38, to: 0.62, period: 2200 })))
    .child(div().absolute().left(-1).right(0).top(2.5).h(5).rounded_r(2.5).bg(color)
      .when(Boolean(opts.hum), (el) => el.loop("opacity", { from: 0.8, to: 1, period: 2200 })))
    .child(div().absolute().left(0).right(2).top(3.5).h(3).rounded_r(1.5).bg("#ffffff").opacity(0.95));
  return h_flex().flex_1().min_w(0).items_center().child(hilt(style)).child(blade.child(beam));
}

// Context LEFT, 0 to 100, from the percent used: the blade starts full and burns down.
export const contextLeft = (used) => Math.max(0, Math.min(100, Math.round(100 - used)));

// Blade colour by how much context is left: green above 75%, orange 26 to 75%, red at 25% or less.
// Orange is its own colour, not the theme's "blocked" (that's the needs-you red). Returns a theme name or a hex.
export const SABER_ORANGE = "#ff9a3d";
export function saberTone(left) {
  if (left <= 25) return "ansi1";
  if (left <= 75) return SABER_ORANGE;
  return "ansi2";
}

// State marks, by shape and colour: a pulsing crystal needs you, a spinning ring is working,
// a four-point star is done, a hollow ring is idle, a short unlit blade is no agent.
export function stateMark(t, status) {
  const box = (el) => div().size(14).flex_none().flex().items_center().justify_center().child(el);
  if (status === "blocked") return box(svg("mods/saber-spaces/crystal.svg").size(11).text_color(t.blocked).loop("opacity", { from: 1, to: 0.4, period: 1400 }));
  if (status === "working") return box(svg("mods/workspace-chrome/spinner.svg").size(11).text_color(t.working).spin(900));
  if (status === "done") return box(svg("mods/saber-spaces/star.svg").size(11).text_color(t.done));
  if (status === "idle") return box(div().size(8).rounded_full().border(1.5).border_color(t.idle ?? t.dim));
  return box(div().w(9).h(2).rounded(1).bg(t.dim));
}

// The "needs you" edge: a thin red blade down the row's left side, glowing.
export function alertEdge(t) {
  return div().absolute().left(0).top(5).bottom(5).w(4).flex().justify_center()
    .child(div().absolute().left(0).top(0).bottom(0).w(4).rounded(2).bg(t.blocked).opacity(0.3))
    .child(div().w(2).h_full().rounded(1).bg(t.blocked).loop("opacity", { from: 1, to: 0.6, period: 1400 }));
}

// Pastel blade colours for the selected row, by the section it sits in.
export const SECTION_GLOW = { blocked: "#f6c79a", done: "#a8e6b8", working: "#a9c9f5", idle: "#c3c7cf" };

// The selected row: a steady saber blade down its left edge, in its section's colour, instead of a filled background.
export function selectedEdge(t, status) {
  const c = SECTION_GLOW[status] ?? SECTION_GLOW.idle;
  return div().absolute().left(0).top(5).bottom(5).w(4).flex().justify_center()
    .child(div().absolute().left(0).top(0).bottom(0).w(4).rounded(2).bg(c).opacity(0.35))
    .child(div().w(2).h_full().rounded(1).bg(c));
}

// Themed section names; plain ones stay in the tooltip-free code paths.
export const SECTION_NAMES = { 4: "Awaiting orders", 3: "Complete", 2: "Hyperspace", 1: "Docked" };
