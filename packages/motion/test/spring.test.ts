import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { Spring } from "../src/index.js";
import {
  between,
  coordinate,
  falsifies,
  integerBetween,
  vectorOf,
} from "./arbitraries.js";

const FRAME_MS = 1000 / 60;

const settleWithin = (
  advance: (from: Spring.Spring, elapsed: number) => Spring.Spring,
  start: Spring.Spring,
  limitMs: number
) => {
  let current = start;

  for (let elapsed = 0; elapsed <= limitMs; elapsed += FRAME_MS) {
    if (Spring.isSettled(current)) {
      return current;
    }

    current = advance(current, FRAME_MS);
  }

  return Spring.isSettled(current) ? current : undefined;
};

const settlesAndSnaps = (
  advance: (from: Spring.Spring, elapsed: number) => Spring.Spring,
  start: Spring.Spring,
  limitMs: number
) => {
  const settled = settleWithin(advance, start, limitMs);

  return (
    settled !== undefined &&
    settled.position.every((value, index) => value === start.target[index]) &&
    settled.velocity.every((value) => value === 0)
  );
};

const neverCrossesTarget = (start: Spring.Spring) => {
  const [origin = 0] = start.position;
  const [target = 0] = start.target;
  const side = Math.sign(origin - target);
  let current = start;

  for (let frame = 0; frame < 2000 && !Spring.isSettled(current); frame += 1) {
    current = Spring.step(current, FRAME_MS);

    if (Math.sign((current.position[0] ?? 0) - target) === -side) {
      return false;
    }
  }

  return true;
};

const criticalStart = Arbitrary.all({
  frequency: between(0.5, 8),
  origin: coordinate,
  target: coordinate,
}).pipe(
  Arbitrary.map(({ frequency, origin, target }) => ({
    frequency,
    spring: Spring.spring({
      config: Spring.critical(frequency),
      position: [origin],
      target: [target],
    }),
  }))
);

const movingSpring = Arbitrary.all({
  frequency: between(0.5, 8),
  position: vectorOf(3),
  ratio: between(0.2, 1.5),
  target: vectorOf(3),
  velocity: vectorOf(3),
}).pipe(
  Arbitrary.map(({ frequency, position, ratio, target, velocity }) => {
    const critical = Spring.critical(frequency);

    return Spring.spring({
      config: Spring.springConfig({
        damping: critical.damping * ratio,
        stiffness: critical.stiffness,
      }),
      position,
      target,
      velocity,
    });
  })
);

const settlingSpring = Arbitrary.all({
  frequency: between(0.3, 8),
  offset: between(-0.005, 0.005),
  ratio: between(0.01, 1),
  target: coordinate,
  velocity: between(-0.025, 0.025),
}).pipe(
  Arbitrary.map(({ frequency, offset, ratio, target, velocity }) => {
    const critical = Spring.critical(frequency);

    return {
      ...Spring.spring({
        config: Spring.springConfig({
          damping: critical.damping * ratio,
          stiffness: critical.stiffness,
        }),
        position: [target + 1],
        target: [target],
      }),
      position: [target + offset],
      velocity: [velocity],
    };
  })
);

const anySpring = Arbitrary.flatMap(
  Arbitrary.schema(Schema.Boolean),
  (settling) => (settling ? settlingSpring : movingSpring)
);

const keepsMotionAcrossRetarget = (
  retarget: (from: Spring.Spring, target: readonly number[]) => Spring.Spring,
  from: Spring.Spring,
  target: readonly number[]
) => {
  const next = retarget(from, target);

  return (
    Spring.isSettled(next) ||
    (next.position.every((value, index) => value === from.position[index]) &&
      next.velocity.every((value, index) => value === from.velocity[index]))
  );
};

const springsEqual = (left: Spring.Spring, right: Spring.Spring) =>
  left.settled === right.settled &&
  left.position.every((value, index) => value === right.position[index]) &&
  left.velocity.every((value, index) => value === right.velocity[index]);

const splitAgrees = (
  advance: (from: Spring.Spring, elapsed: number) => Spring.Spring,
  from: Spring.Spring,
  first: number,
  second: number
) =>
  springsEqual(
    advance(
      advance(from, first * Spring.SUBSTEP_MS),
      second * Spring.SUBSTEP_MS
    ),
    advance(from, (first + second) * Spring.SUBSTEP_MS)
  );

const wholeFrameEuler = (
  from: Spring.Spring,
  elapsed: number
): Spring.Spring => {
  const seconds = elapsed / 1000;

  const velocity = from.velocity.map(
    (value, index) =>
      value +
      ((-from.config.stiffness *
        ((from.position[index] ?? 0) - (from.target[index] ?? 0)) -
        from.config.damping * value) /
        from.config.mass) *
        seconds
  );

  return {
    ...from,
    position: from.position.map(
      (value, index) => value + (velocity[index] ?? 0) * seconds
    ),
    velocity,
  };
};

const forgetsVelocity = (
  from: Spring.Spring,
  target: readonly number[]
): Spring.Spring => ({
  ...Spring.retarget(from, target),
  velocity: from.velocity.map(() => 0),
});

const springWithoutSnap = (from: Spring.Spring, elapsed: number) => {
  const next = Spring.step(from, elapsed);

  return Spring.isSettled(next) && !Spring.isSettled(from)
    ? { ...next, position: from.position }
    : next;
};

describe("spring", () => {
  it.prop(
    "a critically damped spring from rest settles within six periods and snaps exactly onto its target",
    { start: criticalStart },
    ({ start: { frequency, spring } }) => {
      expect(settlesAndSnaps(Spring.step, spring, 6000 / frequency)).toBe(true);
    }
  );

  it.prop(
    "a critically damped 1D spring from rest never overshoots",
    { start: criticalStart },
    ({ start: { spring } }) => {
      expect(neverCrossesTarget(spring)).toBe(true);
    }
  );

  it.prop(
    "retargeting keeps position and velocity",
    { from: movingSpring, target: vectorOf(3) },
    ({ from, target }) => {
      expect(keepsMotionAcrossRetarget(Spring.retarget, from, target)).toBe(
        true
      );
    }
  );

  it.prop(
    "one step equals two steps that split it on the substep grid",
    {
      first: integerBetween(0, 6),
      from: anySpring,
      second: integerBetween(0, 6),
    },
    ({ first, from, second }) => {
      expect(splitAgrees(Spring.step, from, first, second)).toBe(true);
    },
    { arbitrary: { runs: 3000 } }
  );

  it.prop(
    "stepping in place into numbers or a Float64Array matches the allocating step",
    { elapsed: between(0, 200), from: movingSpring },
    ({ elapsed, from }) => {
      const expected = Spring.step(from, elapsed);

      const inPlace = Spring.stepInto(from, elapsed, {
        ...from,
        position: [...from.position],
        target: [...from.target],
        velocity: [...from.velocity],
      });

      const typed = Spring.stepInto(from, elapsed, {
        ...from,
        position: Float64Array.from(from.position),
        target: Float64Array.from(from.target),
        velocity: Float64Array.from(from.velocity),
      });

      expect(springsEqual(expected, inPlace)).toBe(true);
      expect([...typed.position]).toStrictEqual(expected.position);
      expect([...typed.velocity]).toStrictEqual(expected.velocity);
    }
  );

  it.prop(
    "a huge frame gap is clamped to the longest step",
    { elapsed: between(Spring.MAX_STEP_MS, 60_000), from: movingSpring },
    ({ elapsed, from }) => {
      expect(
        springsEqual(
          Spring.step(from, elapsed),
          Spring.step(from, Spring.MAX_STEP_MS)
        )
      ).toBe(true);
    }
  );

  it("a fixed step sequence reproduces the golden trajectory", () => {
    let current = Spring.spring({
      config: Spring.springConfig({ damping: 12, mass: 1, stiffness: 170 }),
      position: [0, 100],
      target: [100, 0],
      velocity: [0, -50],
    });

    for (const elapsed of [16, 17, 16, 33, 8, 100, 16]) {
      current = Spring.step(current, elapsed);
    }

    expect(current.position).toStrictEqual([
      110.65426307238269, -11.454357326463569,
    ]);
    expect(current.velocity).toStrictEqual([
      302.25782931943866, -287.5221820176667,
    ]);
    expect(current.remainder).toBeCloseTo(0.72, 12);
  });

  it("names the fix for a spring that cannot move", () => {
    expect(() => Spring.critical(0)).toThrow(/frequency in hertz, above 0/u);
    expect(() =>
      Spring.spring({
        config: Spring.critical(2),
        position: [0, 0],
        target: [1],
      })
    ).toThrow(/same number of components/u);
  });

  describe("planted bugs", () => {
    it.effect("the settle property catches a spring that never snaps", () =>
      falsifies(criticalStart, ({ frequency, spring }) =>
        settlesAndSnaps(springWithoutSnap, spring, 6000 / frequency)
      )
    );

    it.effect("the overshoot property catches an underdamped spring", () =>
      falsifies(criticalStart, ({ spring }) =>
        neverCrossesTarget({
          ...spring,
          config: { ...spring.config, damping: spring.config.damping / 4 },
        })
      )
    );

    it.effect(
      "the retarget property catches a retarget that drops velocity",
      () =>
        falsifies(
          Arbitrary.all([movingSpring, vectorOf(3)]),
          ([from, target]) =>
            keepsMotionAcrossRetarget(forgetsVelocity, from, target)
        )
    );

    it.effect(
      "the frame-rate property catches an integrator that takes whole frames",
      () =>
        falsifies(
          Arbitrary.all([
            movingSpring,
            integerBetween(1, 6),
            integerBetween(1, 6),
          ]),
          ([from, first, second]) =>
            splitAgrees(wholeFrameEuler, from, first, second)
        )
    );
  });
});
