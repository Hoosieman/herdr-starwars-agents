// The usage saberstaff for the title strip: one double-bladed hilt, the Claude 5-hour window's blade to its left and
// the weekly limit's blade to its right, each lit to the % left. Each window's % left and time to reset always show
// beside its blade; the blades rest in the hilt and ignite while the staff is hovered, the same way an agent row's
// context saber does (saber-agents: IGNITE_MS out, RETRACT_MS back in). The numbers come from limits.js.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";

// Same colour rule as the context sabers (saber-agents/saber.js saberTone): green above 75% left, orange 26 to 75,
// red at 25 or less.
const SABER_ORANGE = "#ff9a3d";
export function saberTone(left) {
  if (left <= 25) return "ansi1";
  if (left <= 75) return SABER_ORANGE;
  return "ansi2";
}

// A double-bladed hilt, 82 px: emitter, ridged grip with a red button, a centre band with a red button, grip with a
// red button, emitter. Three red buttons in all.
function staffHilt() {
  const red = () => div().size(3).rounded_full().bg("#ff4a4a");
  const grip = () => {
    const marks = [];
    for (let i = 0; i < 6; i++) {
      if (i === 3) marks.push(red());
      marks.push(div().w(1).h(5).rounded(0.5).bg("#8a919b"));
    }
    return h_flex().w(22).h(5).bg("#2b2e34").justify_around().items_center().children(marks);
  };
  return h_flex().flex_none().items_center()
    .child(div().w(3).h(5).bg("#1e2025"))
    .child(div().w(9).h(8).rounded_l(1.5).bg("#b9bfc7"))
    .child(grip())
    .child(h_flex().w(14).h(7).bg("#4a4f57").justify_center().items_center().child(red()))
    .child(grip())
    .child(div().w(9).h(8).rounded_r(1.5).bg("#b9bfc7"))
    .child(div().w(3).h(5).bg("#1e2025"));
}

// One blade, BLADE_W px of room (the sidebar's run about 150), BLADE_H px tall, lit to `left`% out from the hilt:
// glow, coloured edge and a white core; the unlit rest is a faint track. `side` "left" grows leftward from the hilt.
// `reach` (0 to 1) is how far the blade is out of the hilt: 0 is the track alone.
const BLADE_W = 240;
const BLADE_H = 14;
const HALO = 6;
// The emitter's extra glow: [length px, opacity] of each faint copy, longest first.
const EMITTER = [[70, 0.12], [44, 0.13], [22, 0.15]];
// Glow colours per blade colour: `haze` for the outer glow, `edge` for the band against the white core. A dim
// orange on the dark strip reads as brown, so the orange blade's haze is a more saturated red-orange (it fades to
// an ember instead) and its edge a lighter peach (hot, like the green's pastel edge). Other colours use their own.
const GLOW = { [SABER_ORANGE]: { haze: "#ff6a10", edge: "#ffb46a" } };
function blade(t, left, color, side, reach = 1) {
  const w = (Math.max(2, Math.min(100, left)) / 100) * BLADE_W * Math.max(0, Math.min(1, reach));
  const L = side === "left";
  const haze = GLOW[color]?.haze ?? color, edge = GLOW[color]?.edge ?? color;
  // Each layer starts a few px back over the emitter (the hilt side) so the blade bleeds onto it.
  const layer = (back, inset, round) => {
    const el = div().absolute().top(inset).h(BLADE_H - 2 * inset);
    return L ? el.right(-back).left(0).rounded_l(round) : el.left(-back).right(0).rounded_r(round);
  };
  // A lit blade hums like a real one: a soft halo wider than the blade and the glow layers swell and fade in a
  // slow pulse (the context sabers' hum, saber-agents/saber.js), each a little out of step so it shimmers. The
  // white core stays steady. `HALO` px of haze spill above and below the blade.
  const hum = (el, from, to, period) => el.loop("opacity", { from, to, period });
  const beam = (L ? div().absolute().right(0) : div().absolute().left(0)).top(0).h(BLADE_H).w(w)
    .child(hum((L ? div().absolute().right(-10).left(-4).rounded_l(BLADE_H) : div().absolute().left(-10).right(-4).rounded_r(BLADE_H))
      .top(-HALO).h(BLADE_H + 2 * HALO).rounded(BLADE_H).bg(haze), 0.05, 0.13, 2200))
    .child(hum(layer(6, -2, BLADE_H / 2 + 2).rounded(BLADE_H / 2 + 2).bg(haze), 0.12, 0.3, 2200))
    .child(hum(layer(6, 0, BLADE_H / 2).rounded(BLADE_H / 2).bg(haze), 0.18, 0.42, 1700))
    .child(hum(layer(3, 2.5, 4.5).rounded(4.5).bg(color), 0.45, 0.68, 1700))
    .child(hum(layer(1, 3.5, 3.5).bg(edge), 0.85, 1, 1300))
    // Hotter at the emitter: the blade's own glow, a touch brighter over its first stretch. Three faint copies
    // of the glow, shorter each time, stack up near the hilt; they stay inside the blade's outline, so it reads
    // as the glow thickening there rather than as anything added on.
    .children(EMITTER.map(([len, o]) => {
      const seg = (inset, back) => (L ? div().absolute().right(-back) : div().absolute().left(-back))
        .w(Math.min(len, w) + back).top(inset).h(BLADE_H - 2 * inset).rounded((BLADE_H - 2 * inset) / 2);
      return div().absolute().inset_0()
        .child(seg(0, 6).bg(haze).opacity(o))
        .child(seg(2.5, 3).bg(color).opacity(o * 1.5));
    }))
    .child((L ? div().absolute().right(0).left(2).rounded_l(2) : div().absolute().left(0).right(2).rounded_r(2))
      .top(5).h(4).bg("#ffffff").opacity(0.95));
  return div().w(BLADE_W).h(BLADE_H).flex_none().relative()
    .child(div().absolute().left(0).right(0).top(BLADE_H / 2 - 0.5).h(1).rounded_full().bg(t.input).opacity(0.4))
    .when(w > 0, (el) => el.child(beam));
}

// The whole staff with its labels. `l` is parseLimits()'s `{ five, week }` (either may be null: that side is drawn
// unlit); `reach` (0 to 1) is how far the blades are out of the hilt; `onHover(on, cx)` is called as the pointer
// enters and leaves.
export function usageStaff(t, l, reach, onHover) {
  const tone = (w) => { const k = saberTone(w.left); return t[k] ?? k; };
  const side = (w, s) => (w ? blade(t, w.left, tone(w), s, reach) : blade(t, 0, t.dim, s, 0).opacity(0.3));
  // Fixed-width label slots, so the staff stays centred whatever the numbers read.
  const info = (name, w, align) => div().w(132).flex_none().whitespace_nowrap().text_size(11.5)
    .child(w
      ? h_flex().gap(5).when(align === "right", (r) => r.justify_end())
        .child(div().text_color(t.muted).child(name))
        .child(div().text_color(tone(w)).child(`${w.left}%`))
        .child(div().text_color(t.dim).child(w.until ? `· ${w.until}` : "· reset"))
      : h_flex().when(align === "right", (r) => r.justify_end()).child(div().text_color(t.dim).child(`${name} —`)));
  return h_flex().id("usage-staff").flex_none().gap(10).items_center()
    .on_hover(onHover)
    .child(info("5h", l?.five, "right"))
    .child(h_flex().flex_none().items_center()
      .child(side(l?.five, "left"))
      .child(staffHilt())
      .child(side(l?.week, "right")))
    .child(info("Week", l?.week, "left"));
}
