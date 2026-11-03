export type Easing = (progress: number) => number;

export class MotionInputError extends Error {
  override readonly name = "MotionInputError";
}

const pinned =
  (curve: Easing): Easing =>
  (progress) => {
    if (progress <= 0) {
      return 0;
    }

    if (progress >= 1) {
      return 1;
    }

    return curve(progress);
  };

const HALF_PI = Math.PI / 2;

const BACK_OVERSHOOT = 1.70158;

const BACK_IN_OUT_OVERSHOOT = BACK_OVERSHOOT * 1.525;

const ELASTIC_PERIOD = (2 * Math.PI) / 3;

const ELASTIC_IN_OUT_PERIOD = (2 * Math.PI) / 4.5;

const BOUNCE_SCALE = 7.5625;

const BOUNCE_SPAN = 2.75;

const powerIn = (power: number) => pinned((t) => t ** power);

const powerOut = (power: number) => pinned((t) => 1 - (1 - t) ** power);

const powerInOut = (power: number) =>
  pinned((t) =>
    t < 0.5 ? 2 ** (power - 1) * t ** power : 1 - (2 - 2 * t) ** power / 2
  );

const bounceOutCurve = (t: number) => {
  if (t < 1 / BOUNCE_SPAN) {
    return BOUNCE_SCALE * t * t;
  }

  if (t < 2 / BOUNCE_SPAN) {
    const offset = t - 1.5 / BOUNCE_SPAN;

    return BOUNCE_SCALE * offset * offset + 0.75;
  }

  if (t < 2.5 / BOUNCE_SPAN) {
    const offset = t - 2.25 / BOUNCE_SPAN;

    return BOUNCE_SCALE * offset * offset + 0.9375;
  }

  const offset = t - 2.625 / BOUNCE_SPAN;

  return BOUNCE_SCALE * offset * offset + 0.984375;
};

export const linear: Easing = pinned((t) => t);

export const quadIn = powerIn(2);

export const quadOut = powerOut(2);

export const quadInOut = powerInOut(2);

export const cubicIn = powerIn(3);

export const cubicOut = powerOut(3);

export const cubicInOut = powerInOut(3);

export const quartIn = powerIn(4);

export const quartOut = powerOut(4);

export const quartInOut = powerInOut(4);

export const quintIn = powerIn(5);

export const quintOut = powerOut(5);

export const quintInOut = powerInOut(5);

export const sineIn: Easing = pinned((t) => 1 - Math.cos(t * HALF_PI));

export const sineOut: Easing = pinned((t) => Math.sin(t * HALF_PI));

export const sineInOut: Easing = pinned((t) => (1 - Math.cos(Math.PI * t)) / 2);

export const expoIn: Easing = pinned((t) => 2 ** (10 * t - 10));

export const expoOut: Easing = pinned((t) => 1 - 2 ** (-10 * t));

export const expoInOut: Easing = pinned((t) =>
  t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (10 - 20 * t)) / 2
);

export const circIn: Easing = pinned((t) => 1 - Math.sqrt(1 - t * t));

export const circOut: Easing = pinned((t) => Math.sqrt(1 - (t - 1) ** 2));

export const circInOut: Easing = pinned((t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2
    : (Math.sqrt(1 - (2 - 2 * t) ** 2) + 1) / 2
);

export const backIn: Easing = pinned(
  (t) => (BACK_OVERSHOOT + 1) * t ** 3 - BACK_OVERSHOOT * t * t
);

export const backOut: Easing = pinned(
  (t) => 1 + (BACK_OVERSHOOT + 1) * (t - 1) ** 3 + BACK_OVERSHOOT * (t - 1) ** 2
);

export const backInOut: Easing = pinned((t) =>
  t < 0.5
    ? ((2 * t) ** 2 *
        ((BACK_IN_OUT_OVERSHOOT + 1) * 2 * t - BACK_IN_OUT_OVERSHOOT)) /
      2
    : ((2 * t - 2) ** 2 *
        ((BACK_IN_OUT_OVERSHOOT + 1) * (2 * t - 2) + BACK_IN_OUT_OVERSHOOT) +
        2) /
      2
);

export const elasticIn: Easing = pinned(
  (t) => -(2 ** (10 * t - 10)) * Math.sin((10 * t - 10.75) * ELASTIC_PERIOD)
);

export const elasticOut: Easing = pinned(
  (t) => 2 ** (-10 * t) * Math.sin((10 * t - 0.75) * ELASTIC_PERIOD) + 1
);

export const elasticInOut: Easing = pinned((t) =>
  t < 0.5
    ? -(
        2 ** (20 * t - 10) *
        Math.sin((20 * t - 11.125) * ELASTIC_IN_OUT_PERIOD)
      ) / 2
    : (2 ** (10 - 20 * t) *
        Math.sin((20 * t - 11.125) * ELASTIC_IN_OUT_PERIOD)) /
        2 +
      1
);

export const bounceOut: Easing = pinned(bounceOutCurve);

export const bounceIn: Easing = pinned((t) => 1 - bounceOutCurve(1 - t));

export const bounceInOut: Easing = pinned((t) =>
  t < 0.5
    ? (1 - bounceOutCurve(1 - 2 * t)) / 2
    : (1 + bounceOutCurve(2 * t - 1)) / 2
);

const NEWTON_ITERATIONS = 8;

const NEWTON_MIN_SLOPE = 1e-6;

const NEWTON_PRECISION = 1e-14;

const BISECTION_ITERATIONS = 64;

const bezierAxis = (first: number, second: number, s: number) =>
  ((1 - 3 * second + 3 * first) * s + (3 * second - 6 * first)) * s * s +
  3 * first * s;

const bezierSlope = (first: number, second: number, s: number) =>
  (3 * (1 - 3 * second + 3 * first) * s + 2 * (3 * second - 6 * first)) * s +
  3 * first;

const newtonParameter = (x1: number, x2: number, x: number) => {
  let s = x;

  for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration += 1) {
    const slope = bezierSlope(x1, x2, s);

    if (Math.abs(slope) < NEWTON_MIN_SLOPE) {
      return null;
    }

    const error = bezierAxis(x1, x2, s) - x;

    if (Math.abs(error) < NEWTON_PRECISION) {
      return s;
    }

    s -= error / slope;
  }

  return null;
};

const bisectParameter = (x1: number, x2: number, x: number) => {
  let low = 0;
  let high = 1;

  for (let iteration = 0; iteration < BISECTION_ITERATIONS; iteration += 1) {
    const middle = (low + high) / 2;

    if (middle === low || middle === high) {
      break;
    }

    if (bezierAxis(x1, x2, middle) < x) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return (low + high) / 2;
};

const solveBezierParameter = (x1: number, x2: number, x: number) => {
  const newton = newtonParameter(x1, x2, x);

  return newton !== null && newton >= 0 && newton <= 1
    ? newton
    : bisectParameter(x1, x2, x);
};

const requireUnitInterval = (name: string, value: number) => {
  if (!(value >= 0 && value <= 1)) {
    throw new MotionInputError(
      `cubicBezier ${name} is ${value}. CSS requires x control points in [0, 1] so the curve stays a function of time; clamp ${name} into [0, 1].`
    );
  }
};

export const cubicBezier = (
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Easing => {
  requireUnitInterval("x1", x1);
  requireUnitInterval("x2", x2);

  if (!(Number.isFinite(y1) && Number.isFinite(y2))) {
    throw new MotionInputError(
      `cubicBezier y control points must be finite, got y1 ${y1} and y2 ${y2}. Pass finite values; y may leave [0, 1] to overshoot.`
    );
  }

  if (x1 === y1 && x2 === y2) {
    return linear;
  }

  return pinned((x) => bezierAxis(y1, y2, solveBezierParameter(x1, x2, x)));
};

export type StepPosition =
  | "jump-start"
  | "jump-end"
  | "jump-none"
  | "jump-both"
  | "start"
  | "end";

const jumpCount = (count: number, position: StepPosition) => {
  if (position === "jump-none") {
    return count - 1;
  }

  if (position === "jump-both") {
    return count + 1;
  }

  return count;
};

export const steps = (
  count: number,
  position: StepPosition = "jump-end"
): Easing => {
  if (!Number.isInteger(count) || count < 1) {
    throw new MotionInputError(
      `steps count is ${count}. CSS requires a positive integer; round it and pass at least 1.`
    );
  }

  if (position === "jump-none" && count < 2) {
    throw new MotionInputError(
      `steps(${count}, jump-none) has no interval to step across. CSS requires at least 2 steps for jump-none; pass 2 or more.`
    );
  }

  const jumps = jumpCount(count, position);

  const startOffset =
    position === "jump-start" ||
    position === "start" ||
    position === "jump-both"
      ? 1
      : 0;

  return (input) => {
    const progress = Math.min(1, Math.max(0, input));

    return Math.min(Math.floor(progress * count) + startOffset, jumps) / jumps;
  };
};

export const ease = cubicBezier(0.25, 0.1, 0.25, 1);

export const easeIn = cubicBezier(0.42, 0, 1, 1);

export const easeOut = cubicBezier(0, 0, 0.58, 1);

export const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

export const stepStart = steps(1, "jump-start");

export const stepEnd = steps(1, "jump-end");

export const easings = {
  backIn,
  backInOut,
  backOut,
  bounceIn,
  bounceInOut,
  bounceOut,
  circIn,
  circInOut,
  circOut,
  cubicIn,
  cubicInOut,
  cubicOut,
  ease,
  "ease-in": easeIn,
  "ease-in-out": easeInOut,
  "ease-out": easeOut,
  elasticIn,
  elasticInOut,
  elasticOut,
  expoIn,
  expoInOut,
  expoOut,
  linear,
  quadIn,
  quadInOut,
  quadOut,
  quartIn,
  quartInOut,
  quartOut,
  quintIn,
  quintInOut,
  quintOut,
  sineIn,
  sineInOut,
  sineOut,
  "step-end": stepEnd,
  "step-start": stepStart,
} as const satisfies Readonly<Record<string, Easing>>;

export type EasingName = keyof typeof easings;

export const easingNames: readonly EasingName[] = [
  "linear",
  "quadIn",
  "quadOut",
  "quadInOut",
  "cubicIn",
  "cubicOut",
  "cubicInOut",
  "quartIn",
  "quartOut",
  "quartInOut",
  "quintIn",
  "quintOut",
  "quintInOut",
  "sineIn",
  "sineOut",
  "sineInOut",
  "expoIn",
  "expoOut",
  "expoInOut",
  "circIn",
  "circOut",
  "circInOut",
  "backIn",
  "backOut",
  "backInOut",
  "elasticIn",
  "elasticOut",
  "elasticInOut",
  "bounceIn",
  "bounceOut",
  "bounceInOut",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
];

export type CubicBezierSpec =
  `cubic-bezier(${number}, ${number}, ${number}, ${number})`;

export type StepsSpec =
  | `steps(${number})`
  | `steps(${number}, ${StepPosition})`;

export type EasingSpec = EasingName | CubicBezierSpec | StepsSpec;

const namedEasings: ReadonlyMap<string, Easing> = new Map(
  easingNames.map((name) => [name, easings[name]])
);

const stepPositions: ReadonlySet<string> = new Set<StepPosition>([
  "end",
  "jump-both",
  "jump-end",
  "jump-none",
  "jump-start",
  "start",
]);

const isStepPosition = (text: string): text is StepPosition =>
  stepPositions.has(text);

const CUBIC_BEZIER_SPEC =
  /^cubic-bezier\(\s*(?<x1>[^\s,]+)\s*,\s*(?<y1>[^\s,]+)\s*,\s*(?<x2>[^\s,]+)\s*,\s*(?<y2>[^\s),]+)\s*\)$/u;

const STEPS_SPEC =
  /^steps\(\s*(?<count>[^\s),]+)\s*(?:,\s*(?<position>[a-z-]+)\s*)?\)$/u;

const unknownEasing = (spec: string, reason: string) =>
  new MotionInputError(
    `Cannot read easing ${JSON.stringify(spec)}: ${reason}. Use a name such as "cubicOut" or "ease-in-out", cubic-bezier(x1, y1, x2, y2), or steps(count, jump-end).`
  );

const specNumber = (spec: string, text: string) => {
  const value = Number(text);

  if (!Number.isFinite(value)) {
    throw unknownEasing(spec, `${JSON.stringify(text)} is not a finite number`);
  }

  return value;
};

export const parseEasing = (spec: string): Easing => {
  const text = spec.trim();
  const named = namedEasings.get(text);

  if (named !== undefined) {
    return named;
  }

  const bezier = CUBIC_BEZIER_SPEC.exec(text)?.groups;

  if (bezier !== undefined) {
    return cubicBezier(
      specNumber(spec, bezier.x1 ?? ""),
      specNumber(spec, bezier.y1 ?? ""),
      specNumber(spec, bezier.x2 ?? ""),
      specNumber(spec, bezier.y2 ?? "")
    );
  }

  const stepped = STEPS_SPEC.exec(text)?.groups;

  if (stepped !== undefined) {
    const position = stepped.position ?? "jump-end";

    if (!isStepPosition(position)) {
      throw unknownEasing(spec, `${position} is not a CSS step position`);
    }

    return steps(specNumber(spec, stepped.count ?? ""), position);
  }

  throw unknownEasing(spec, "the format is not recognised");
};

export const isEasingSpec = (spec: string): spec is EasingSpec => {
  try {
    parseEasing(spec);

    return true;
  } catch {
    return false;
  }
};

export const resolveEasing = (spec: EasingSpec): Easing => parseEasing(spec);
