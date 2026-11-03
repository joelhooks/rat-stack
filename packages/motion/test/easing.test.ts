import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  backIn,
  cubicBezier,
  easingNames,
  easings,
  MotionInputError,
  parseEasing,
  quadOut,
  steps,
} from "../src/index.js";
import type { Easing, EasingName, StepPosition } from "../src/index.js";
import {
  falsifies,
  integerBetween,
  orderedUnitPair,
  unit,
} from "./arbitraries.js";

const TOLERANCE = 1e-9;

const families = [
  "quad",
  "cubic",
  "quart",
  "quint",
  "sine",
  "expo",
  "circ",
  "back",
  "elastic",
  "bounce",
] as const;

type Family = (typeof families)[number];

const curve = (family: Family, variant: "In" | "Out" | "InOut") =>
  easings[`${family}${variant}`];

const monotonicNames: readonly EasingName[] = easingNames.filter(
  (name) => !/^(?:back|elastic|bounce)/u.test(name)
);

const mirrorable = unit.pipe(
  Arbitrary.filter((progress) => 1 - (1 - progress) === progress)
);

const isPinned = (easing: Easing) => easing(0) === 0 && easing(1) === 1;

const stepPositions = [
  "jump-start",
  "jump-end",
  "jump-none",
  "jump-both",
  "start",
  "end",
] as const satisfies readonly StepPosition[];

const jumpAdjustment: Readonly<Record<StepPosition, number>> = {
  end: 0,
  "jump-both": 1,
  "jump-end": 0,
  "jump-none": -1,
  "jump-start": 0,
  start: 0,
};

const isMonotonicOn = (
  easing: Easing,
  [low, high]: readonly [number, number]
) => easing(low) <= easing(high) + TOLERANCE;

const isOutMirrorOfIn = (inward: Easing, outward: Easing, progress: number) =>
  Math.abs(outward(progress) - (1 - inward(1 - progress))) <= TOLERANCE;

const isPointSymmetric = (easing: Easing, progress: number) =>
  Math.abs(easing(progress) - (1 - easing(1 - progress))) <= TOLERANCE;

const bezierPoint = (first: number, second: number, s: number) =>
  3 * (1 - s) ** 2 * s * first + 3 * (1 - s) * s * s * second + s ** 3;

const referenceBezier =
  (x1: number, y1: number, x2: number, y2: number): Easing =>
  (x) => {
    let low = 0;
    let high = 1;

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const middle = (low + high) / 2;

      if (bezierPoint(x1, x2, middle) < x) {
        low = middle;
      } else {
        high = middle;
      }
    }

    return bezierPoint(y1, y2, (low + high) / 2);
  };

const controlPoints = Arbitrary.all([unit, unit, unit, unit]);

const matchesReference = (
  build: (x1: number, y1: number, x2: number, y2: number) => Easing,
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  progress: number
) =>
  Math.abs(
    build(x1, y1, x2, y2)(progress) - referenceBezier(x1, y1, x2, y2)(progress)
  ) <= 1e-7;

const parameterAsProgress =
  (_x1: number, y1: number, _x2: number, y2: number): Easing =>
  (progress) =>
    bezierPoint(y1, y2, progress);

describe("easing", () => {
  it("every curve except a start jump begins at 0 and ends at 1", () => {
    for (const name of easingNames) {
      expect(
        name === "step-start" ? easings[name](1) === 1 : isPinned(easings[name])
      ).toBe(true);
    }
  });

  it.prop(
    "curves that should be monotonic never fall",
    { pair: orderedUnitPair },
    ({ pair }) => {
      for (const name of monotonicNames) {
        expect(isMonotonicOn(easings[name], pair)).toBe(true);
      }
    }
  );

  it.prop(
    "every out curve mirrors its in curve: out(t) = 1 - in(1 - t)",
    { progress: mirrorable },
    ({ progress }) => {
      for (const family of families) {
        expect(
          isOutMirrorOfIn(curve(family, "In"), curve(family, "Out"), progress)
        ).toBe(true);
      }
    }
  );

  it.prop(
    "every in-out curve is point-symmetric about its midpoint",
    { progress: mirrorable },
    ({ progress }) => {
      for (const family of families) {
        expect(isPointSymmetric(curve(family, "InOut"), progress)).toBe(true);
      }
    }
  );

  it.prop(
    "in-out curves outside back and elastic run the in curve at double speed for their first half",
    { progress: unit },
    ({ progress }) => {
      for (const family of families.filter(
        (name) => name !== "back" && name !== "elastic"
      )) {
        expect(
          Math.abs(
            curve(family, "InOut")(progress / 2) -
              curve(family, "In")(progress) / 2
          )
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  );

  it.prop(
    "cubicBezier with control points inside the unit square is monotonic and pinned",
    { pair: orderedUnitPair, points: controlPoints },
    ({ pair, points }) => {
      const easing = cubicBezier(...points);

      expect(isMonotonicOn(easing, pair)).toBe(true);
      expect(isPinned(easing)).toBe(true);
    }
  );

  it.prop(
    "cubicBezier agrees with a bisection reference for any valid control points",
    {
      points: Arbitrary.all([unit, unit, unit, unit]).pipe(
        Arbitrary.map(
          ([x1, y1, x2, y2]) => [x1, y1 * 4 - 2, x2, y2 * 4 - 2] as const
        )
      ),
      progress: unit,
    },
    ({ points, progress }) => {
      expect(matchesReference(cubicBezier, points, progress)).toBe(true);
    }
  );

  it.each([
    ["ease", 0.1, 0.094796305716],
    ["ease", 0.25, 0.408510591355],
    ["ease", 0.5, 0.802403387585],
    ["ease", 0.75, 0.960458978349],
    ["ease", 0.9, 0.994316477485],
    ["ease-in", 0.1, 0.017026609652],
    ["ease-in", 0.25, 0.093464650719],
    ["ease-in", 0.5, 0.315356812573],
    ["ease-in", 0.75, 0.621861869175],
    ["ease-in", 0.9, 0.839427845762],
    ["ease-out", 0.1, 0.160572154238],
    ["ease-out", 0.5, 0.684643187427],
    ["ease-out", 0.9, 0.982973390348],
    ["ease-in-out", 0.1, 0.019722453548],
    ["ease-in-out", 0.25, 0.129161931047],
    ["ease-in-out", 0.5, 0.5],
    ["ease-in-out", 0.75, 0.870838068953],
    ["cubic-bezier(0.68, -0.55, 0.265, 1.55)", 0.1, -0.066291477334],
    ["cubic-bezier(0.68, -0.55, 0.265, 1.55)", 0.25, -0.082807108828],
    ["cubic-bezier(0.68, -0.55, 0.265, 1.55)", 0.5, 0.606679897224],
    ["cubic-bezier(0.68, -0.55, 0.265, 1.55)", 0.75, 1.089165774813],
    ["cubic-bezier(0.68, -0.55, 0.265, 1.55)", 0.9, 1.062373195166],
  ] as const)(
    "%s at %d matches the exact-rational reference table",
    (spec, progress, expected) => {
      expect(parseEasing(spec)(progress)).toBeCloseTo(expected, 10);
    }
  );

  it.prop(
    "steps follows the CSS jump rules for every count and position",
    {
      count: integerBetween(2, 24),
      position: Arbitrary.schema(Schema.Literals(stepPositions)),
      progress: unit,
    },
    ({ count, position, progress }) => {
      const easing = steps(count, position);
      const jumps = count + jumpAdjustment[position];
      const value = easing(progress) * jumps;

      expect(Math.abs(value - Math.round(value))).toBeLessThan(TOLERANCE);
      expect(easing(1)).toBe(1);
      expect(easing(0)).toBe(
        position === "jump-start" ||
          position === "start" ||
          position === "jump-both"
          ? 1 / jumps
          : 0
      );
    }
  );

  it("names the fix when a curve cannot be built", () => {
    expect(() => cubicBezier(1.2, 0, 0.5, 1)).toThrow(
      /x1 is 1\.2\. CSS requires x control points in \[0, 1\]/u
    );
    expect(() => steps(0)).toThrow(MotionInputError);
    expect(() => steps(1, "jump-none")).toThrow(/at least 2 steps/u);
    expect(() => parseEasing("wobbly")).toThrow(
      /Use a name such as "cubicOut"/u
    );
    expect(parseEasing("steps(4, jump-start)")(0)).toBe(0.25);
  });

  describe("planted bugs", () => {
    it.effect("the monotonic property catches a curve that dips", () =>
      falsifies(orderedUnitPair, (pair) => isMonotonicOn(backIn, pair))
    );

    it.effect("the mirror property catches a mismatched out curve", () =>
      falsifies(unit, (progress) =>
        isOutMirrorOfIn(easings.cubicIn, quadOut, progress)
      )
    );

    it.effect("the point symmetry property catches a lopsided in-out", () =>
      falsifies(unit, (progress) => isPointSymmetric(easings.quadIn, progress))
    );

    it.effect(
      "the reference property catches a solver that skips the x inversion",
      () =>
        falsifies(Arbitrary.all([controlPoints, unit]), ([points, progress]) =>
          matchesReference(parameterAsProgress, points, progress)
        )
    );

    it("the endpoint check catches an unpinned curve", () => {
      expect(isPinned((progress) => progress ** 2 + 0.001)).toBe(false);
    });
  });
});
