# @rat-stack/motion

Easing, tweens, springs and interpolation for Foldkit apps. The core is plain TypeScript with no runtime dependencies. A separate entry, `@rat-stack/motion/foldkit`, wires it into a Foldkit program.

## Core

The four `src/*.pure.ts` modules import only each other. To vendor them, copy all four files at a pinned commit. `test/vendoring.test.ts` keeps it that way.

- **`easing.pure.ts`**:
  - Robert Penner's set: `quad`, `cubic`, `quart`, `quint`, `sine`, `expo`, `circ`, `back`, `elastic` and `bounce`, each as `In`, `Out` and `InOut`, plus `linear`.
  - `cubicBezier(x1, y1, x2, y2)` and `steps(count, position)` follow the CSS Easing Functions spec. The CSS keywords `ease`, `ease-in`, `ease-out`, `ease-in-out`, `step-start` and `step-end` are presets.
  - An `EasingSpec` is data: a name such as `"cubicOut"`, or a CSS string such as `"cubic-bezier(0.68, -0.55, 0.265, 1.55)"` or `"steps(4, jump-start)"`. `parseEasing` turns it into a function.
- **`tween.pure.ts`**: `tween({ from, to, duration, easing, startedAt })`, then `sample(tween, now)`, `isDone`, `retarget(tween, to, now)` and `finish`. A retarget starts from the value sampled at `now`, so the value never jumps.
- **`spring.pure.ts`**:
  - `spring({ config, position, target, velocity })` holds N-dimensional state. Build the config with `springConfig({ stiffness, damping, mass })` or `critical(frequency)`.
  - `step(spring, elapsed)` integrates with semi-implicit Euler in fixed 1/120 s substeps and carries the remainder to the next call. A gap longer than `MAX_STEP_MS` (100 ms) is clamped.
  - `stepInto(spring, elapsed, into)` writes into existing arrays, including a `Float64Array`, and allocates nothing.
  - Once position and velocity fall inside `restDelta` and `restSpeed`, the spring snaps exactly onto its target and reports `isSettled`. `retarget` keeps position and velocity.
- **`interpolate.pure.ts`**: `mix` for numbers, `mixVector` for tuples, `mixColor` for colours and `mixTransform` for decomposed 2D transforms. Every mixer returns its endpoints exactly at 0 and 1.

Times are milliseconds everywhere, to match Foldkit's frame delta. A spring that receives the same sequence of frame times always produces the same numbers.

### Colour space

`mixColor` interpolates in OKLab with premultiplied alpha, and `parseColor` reads `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. OKLab is perceptually even, so a blend from blue to yellow passes through lighter colours rather than a muddy grey. CSS Color 5 makes OKLab the default `color-mix()` space, so a mix here follows the browser's default. Linear-light sRGB is physically correct for light, but its midpoints look too bright to the eye.

### Transforms

`Transform2D` is decomposed into translate, scale and rotate (radians). Interpolating the parts keeps a rotation a rotation; lerping raw matrix entries shrinks a shape halfway through a turn. The angle interpolates as given, so `0` to `2π` spins once.

## Foldkit adapter

Keep a `Motion` value in the Model, with a `Clock` and the named tweens and springs:

```ts
import * as Motion from "@rat-stack/motion/foldkit";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

const MotionState = Motion.motionSchema({ springs: ["dot"], tweens: ["fade"] });

export const Model = Schema.Struct({ motion: MotionState });

export const Message = defineMessageUnion({
  GotMotionMessage: { message: Motion.Message },
});
```

- `Motion.motionSubscriptions({ isAnimating, toMessage })` returns two entries. `motionFrame` runs `requestAnimationFrame` only while `isAnimating(model)` is true. `reducedMotion` follows `(prefers-reduced-motion: reduce)` through Foldkit's `Dom.streamFromMediaQuery`, so features never read a browser global.
- `Motion.advance(motion, message)` folds a `TickedFrame` or `ChangedReducedMotion` message into the Motion value. It steps every spring and moves the clock that every tween samples against.
- `Motion.startTween`, `Motion.retargetTween` and `Motion.retargetSpring` read the clock. Under reduced motion, each one lands on its target at once, and turning reduced motion on settles everything already moving.
- `TweenSchema`, `SpringSchema` and `EasingSpecSchema` describe the same values for any other Model field.

Foldkit and Effect are optional peer dependencies. The core needs neither.

## Provenance

Penner's equations are used under the BSD licence, and the spring follows a published idea without copied code. Both are recorded in the root `PROVENANCE.md`.
