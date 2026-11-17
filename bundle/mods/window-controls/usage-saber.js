// The usage saberstaff for the title strip: one double-bladed hilt, the Claude 5-hour window's blade to its left and
// the weekly limit's blade to its right, each lit to the % left. Hovering shows each window's % left and time to
// reset beside its blade. The numbers come from limits.js.
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
const BLADE_W = 240;
const BLADE_H = 14;
function blade(t, left, color, side) {
  const w = (Math.max(2, Math.min(100, left)) / 100) * BLADE_W;
  const L = side === "left";
  // Each layer starts a few px back over the emitter (the hilt side) so the blade bleeds onto it.
  const layer = (back, inset, round) => {
    const el = div().absolute().top(inset).h(BLADE_H - 2 * inset);
    return L ? el.right(-back).left(0).rounded_l(round) : el.left(-back).right(0).rounded_r(round);
  };
  const beam = (L ? div().absolute().right(0) : div().absolute().left(0)).top(0).h(BLADE_H).w(w)
    .child(layer(6, 0, BLADE_H / 2).rounded(BLADE_H / 2).bg(color).opacity(0.2))
    .child(layer(3, 2.5, 4.5).rounded(4.5).bg(color).opacity(0.5))
    .child(layer(1, 3.5, 3.5).bg(color))
    .child((L ? div().absolute().right(0).left(2).rounded_l(1.5) : div().absolute().left(0).right(2).rounded_r(1.5))
      .top(5.5).h(3).bg("#ffffff").opacity(0.95));
  return div().w(BLADE_W).h(BLADE_H).flex_none().relative()
    .child(div().absolute().left(0).right(0).top(BLADE_H / 2 - 0.5).h(1).rounded_full().bg(t.input).opacity(0.4))
    .child(beam);
}

// The whole staff with its hover labels. `l` is parseLimits()'s `{ five, week }` (either may be null: that side is
// drawn unlit); `hover` shows the labels; `onHover(on, cx)` is called as the pointer enters and leaves.
export function usageStaff(t, l, hover, onHover) {
  const tone = (w) => { const k = saberTone(w.left); return t[k] ?? k; };
  const side = (w, s) => (w ? blade(t, w.left, tone(w), s) : blade(t, 0, t.dim, s).opacity(0.3));
  // Fixed-width label slots, so the staff doesn't shift when they appear.
  const info = (name, w, align) => div().w(132).flex_none().whitespace_nowrap().text_size(11.5)
    .when(hover, (el) => el.child(w
      ? h_flex().gap(5).when(align === "right", (r) => r.justify_end())
        .child(div().text_color(t.muted).child(name))
        .child(div().text_color(tone(w)).child(`${w.left}%`))
        .child(div().text_color(t.dim).child(w.until ? `· ${w.until}` : "· reset"))
      : h_flex().when(align === "right", (r) => r.justify_end()).child(div().text_color(t.dim).child(`${name} —`))));
  return h_flex().id("usage-staff").flex_none().gap(10).items_center()
    .on_hover(onHover)
    .child(info("5h", l?.five, "right"))
    .child(h_flex().flex_none().items_center()
      .child(side(l?.five, "left"))
      .child(staffHilt())
      .child(side(l?.week, "right")))
    .child(info("Week", l?.week, "left"));
}
