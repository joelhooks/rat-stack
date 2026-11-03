import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";

import { easingNames, Tween } from "../src/index.js";
import type { EasingName } from "../src/index.js";
import { between, coordinate, falsifies, oneOf } from "./arbitraries.js";

const nonEmpty = (names: readonly EasingName[]) => {
  const [first, ...rest] = names;

  if (first === undefined) {
    throw new Error("Expected at least one easing name in the generator.");
  }

  return [first, ...rest] as const;
};

const monotonicNames = easingNames.filter(
  (name) => !/^(?:back|elastic|bounce)/u.test(name)
);

const monotonicEasing = oneOf(nonEmpty(monotonicNames));

const anyEasing = oneOf(nonEmpty(easingNames));

const restingStartNames = easingNames.filter((name) => name !== "step-start");

const restingStartEasing = oneOf(nonEmpty(restingStartNames));

const tweenOf = (easing: Arbitrary.Arbitrary<EasingName>, shortest = 0) =>
  Arbitrary.all({
    duration: between(shortest, 5000),
    easing,
    from: coordinate,
    startedAt: between(-10_000, 10_000),
    to: coordinate,
  }).pipe(Arbitrary.map((options) => Tween.tween(options)));

const scenario = (easing: Arbitrary.Arbitrary<EasingName>, shortest = 0) =>
  Arbitrary.all({
    animation: tweenOf(easing, shortest),
    offset: between(-1000, 7000),
  });

type Sampler = (animation: Tween.Tween, now: number) => number;

const staysBetweenEndpoints = (
  sample: Sampler,
  animation: Tween.Tween,
  now: number
) => {
  const value = sample(animation, now);

  return (
    value >= Math.min(animation.from, animation.to) &&
    value <= Math.max(animation.from, animation.to)
  );
};

type Retargeter = (
  animation: Tween.Tween,
  to: number,
  now: number
) => Tween.Tween;

const isContinuousAcrossRetarget = (
  retarget: Retargeter,
  animation: Tween.Tween,
  to: number,
  now: number
) =>
  Tween.sample(retarget(animation, to, now), now) ===
  Tween.sample(animation, now);

const unclampedSample: Sampler = (animation, now) =>
  animation.from +
  (animation.to - animation.from) *
    ((now - animation.startedAt) / Math.max(1, animation.duration));

const retargetFromStart: Retargeter = (animation, to, now) => ({
  ...animation,
  startedAt: now,
  to,
});

describe("tween", () => {
  it.prop(
    "a monotonic tween never leaves the span between its endpoints",
    { case: scenario(monotonicEasing) },
    ({ case: { animation, offset } }) => {
      expect(
        staysBetweenEndpoints(
          Tween.sample,
          animation,
          animation.startedAt + offset
        )
      ).toBe(true);
    }
  );

  it.prop(
    "every tween that rests at its start begins at from, lands exactly on to, and is done only from its end",
    { case: scenario(restingStartEasing) },
    ({ case: { animation, offset } }) => {
      const end = animation.startedAt + animation.duration;
      const now = animation.startedAt + offset;

      expect(Tween.sample(animation, end)).toBe(animation.to);
      expect(Tween.sample(animation, Math.max(end, now))).toBe(animation.to);
      expect(Tween.isDone(animation, now)).toBe(now >= end);

      if (animation.duration > 0) {
        expect(Tween.sample(animation, animation.startedAt)).toBe(
          animation.from
        );
      }
    }
  );

  it.prop(
    "retargeting a timed tween that rests at its start keeps the sampled value continuous",
    { case: scenario(restingStartEasing, 1), to: coordinate },
    ({ case: { animation, offset }, to }) => {
      expect(
        isContinuousAcrossRetarget(
          Tween.retarget,
          animation,
          to,
          animation.startedAt + offset
        )
      ).toBe(true);
    }
  );

  it.prop(
    "finishing jumps to the target at the given time",
    { case: scenario(anyEasing) },
    ({ case: { animation, offset } }) => {
      const now = animation.startedAt + offset;
      const finished = Tween.finish(animation, now);

      expect(Tween.isDone(finished, now)).toBe(true);
      expect(Tween.sample(finished, now)).toBe(animation.to);
    }
  );

  it("names the fix for an impossible duration or easing", () => {
    expect(() =>
      Tween.tween({ duration: -1, from: 0, startedAt: 0, to: 1 })
    ).toThrow(/Pass a finite duration of 0 ms or more/u);
  });

  describe("planted bugs", () => {
    it.effect("the clamp property catches a sampler that extrapolates", () =>
      falsifies(scenario(monotonicEasing), ({ animation, offset }) =>
        staysBetweenEndpoints(
          unclampedSample,
          animation,
          animation.startedAt + offset
        )
      )
    );

    it.effect(
      "the continuity property catches a retarget that restarts from the old origin",
      () =>
        falsifies(
          Arbitrary.all([scenario(restingStartEasing, 1), coordinate]),
          ([{ animation, offset }, to]) =>
            isContinuousAcrossRetarget(
              retargetFromStart,
              animation,
              to,
              animation.startedAt + offset
            )
        )
    );
  });
});
