/**
 * Glisse Liquid Glass — Spring engine
 * Source: https://github.com/0kzh/glisse (v0.5.0)
 * MIT License — © Kelvin Zhang
 *
 * Damped-spring integrator (critically/over/under-damped analytic solution)
 * driving rAF paint callbacks, plus the hold-detection helper the touch
 * gestures use. Reduced motion and a hidden document settle instantly.
 */

const moving = new Set();
let frame = 0;
let last = 0;

function advance(s, dt) {
  const x = s.value - s.target;
  const v = s.velocity;
  const half = s.damping / 2;
  const discriminant = half * half - s.stiffness;

  if (Math.abs(discriminant) < 1e-4) {
    // Critically damped.
    const decay = Math.exp(-half * dt);
    const b = v + half * x;
    s.value = s.target + decay * (x + b * dt);
    s.velocity = decay * (v - half * b * dt);
  } else if (discriminant > 0) {
    const root = Math.sqrt(discriminant);
    const r1 = -half + root;
    const r2 = -half - root;
    const a = (v - r2 * x) / (r1 - r2);
    const b = x - a;
    s.value = s.target + a * Math.exp(r1 * dt) + b * Math.exp(r2 * dt);
    s.velocity = a * r1 * Math.exp(r1 * dt) + b * r2 * Math.exp(r2 * dt);
  } else {
    // Under-damped.
    const omega = Math.sqrt(-discriminant);
    const decay = Math.exp(-half * dt);
    const cos = Math.cos(omega * dt);
    const sin = Math.sin(omega * dt);
    s.value = s.target + decay * (x * cos + ((v + half * x) / omega) * sin);
    s.velocity = decay * (v * cos - ((half * v + s.stiffness * x) / omega) * sin);
  }
}

function tick(time) {
  frame = 0;
  const dt = Math.min(0.1, Math.max(0, (time - last) / 1000));
  last = time;
  for (const s of moving) {
    advance(s, dt);
    if (Math.abs(s.value - s.target) < 1e-4 && Math.abs(s.velocity) < 1e-3) {
      s.value = s.target;
      s.velocity = 0;
      moving.delete(s);
    }
    s.paint(s.value);
  }
  if (moving.size) frame = requestAnimationFrame(tick);
}

export function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A spring toward `target`, calling `paint(value)` on every frame.
 * @returns {{paint, set, tune, stop}}
 */
export function createSpring(initial, stiffness, damping, paint) {
  const s = { value: initial, target: initial, velocity: 0, stiffness, damping, paint };
  return {
    paint: () => paint(s.value),
    set(target, instant = false) {
      s.target = target;
      if (instant || document.hidden || prefersReducedMotion()) {
        s.value = target;
        s.velocity = 0;
        moving.delete(s);
        paint(target);
        return;
      }
      moving.add(s);
      if (!frame) {
        // Measure from the start of the current frame, so the next one
        // already shows a frame's worth of motion.
        last = Number(document.timeline?.currentTime ?? performance.now());
        frame = requestAnimationFrame(tick);
      }
    },
    tune(nextStiffness, nextDamping) {
      s.stiffness = nextStiffness;
      s.damping = nextDamping;
    },
    stop: () => moving.delete(s)
  };
}

/**
 * How long a touch rests on a control before it belongs to the control rather
 * than the page. A quick swipe still scrolls; a held press keeps the touch.
 */
export const HOLD = 150;

export const held = (at, moved) => moved || performance.now() - at >= HOLD;