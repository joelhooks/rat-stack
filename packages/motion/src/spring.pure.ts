import { MotionInputError } from "./easing.pure.js";
import type { Vector } from "./interpolate.pure.js";

export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
  readonly restDelta: number;
  readonly restSpeed: number;
}

export interface Spring {
  readonly kind: "spring";
  readonly config: SpringConfig;
  readonly position: Vector;
  readonly velocity: Vector;
  readonly target: Vector;
  readonly remainder: number;
  readonly settled: boolean;
}

export type MutableVector = number[] | Float64Array;

export interface MutableSpring<Storage extends MutableVector = MutableVector> {
  readonly kind: "spring";
  config: SpringConfig;
  position: Storage;
  velocity: Storage;
  target: Storage;
  remainder: number;
  settled: boolean;
}

export const SUBSTEP_MS = 1000 / 120;

export const MAX_STEP_MS = 100;

const SUBSTEP_SECONDS = SUBSTEP_MS / 1000;

const SUBSTEP_GRID_TOLERANCE = 1e-9;

const DEFAULT_REST_DELTA = 0.001;

const DEFAULT_REST_SPEED = 0.001;

export interface SpringParameters {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass?: number;
  readonly restDelta?: number;
  readonly restSpeed?: number;
}

const requirePositive = (name: string, value: number, fix: string) => {
  if (!(value > 0 && Number.isFinite(value))) {
    throw new MotionInputError(`Spring ${name} is ${value}. ${fix}`);
  }
};

export const springConfig = (parameters: SpringParameters): SpringConfig => {
  const config = {
    damping: parameters.damping,
    mass: parameters.mass ?? 1,
    restDelta: parameters.restDelta ?? DEFAULT_REST_DELTA,
    restSpeed: parameters.restSpeed ?? DEFAULT_REST_SPEED,
    stiffness: parameters.stiffness,
  };

  requirePositive(
    "stiffness",
    config.stiffness,
    "Pass a finite stiffness above 0, or use critical(frequency)."
  );
  requirePositive(
    "mass",
    config.mass,
    "Pass a finite mass above 0; 1 is the usual choice."
  );
  requirePositive(
    "restDelta",
    config.restDelta,
    "Pass a finite settle distance above 0 in the same units as the position."
  );
  requirePositive(
    "restSpeed",
    config.restSpeed,
    "Pass a finite settle speed above 0 in position units per second."
  );

  if (!(config.damping >= 0 && Number.isFinite(config.damping))) {
    throw new MotionInputError(
      `Spring damping is ${config.damping}. Pass a finite damping of 0 or more; 0 never settles.`
    );
  }

  return config;
};

export const critical = (
  frequency: number,
  options: Omit<SpringParameters, "stiffness" | "damping"> = {}
): SpringConfig => {
  requirePositive(
    "frequency",
    frequency,
    "Pass the undamped frequency in hertz, above 0."
  );

  const mass = options.mass ?? 1;
  const angular = 2 * Math.PI * frequency;

  return springConfig({
    ...options,
    damping: 2 * mass * angular,
    mass,
    stiffness: mass * angular * angular,
  });
};

const atRest = (
  config: SpringConfig,
  position: ArrayLike<number>,
  velocity: ArrayLike<number>,
  target: ArrayLike<number>
) => {
  for (let index = 0; index < position.length; index += 1) {
    if (
      Math.abs((position[index] ?? 0) - (target[index] ?? 0)) >
        config.restDelta ||
      Math.abs(velocity[index] ?? 0) > config.restSpeed
    ) {
      return false;
    }
  }

  return true;
};

const requireDimensions = (position: Vector, other: Vector, name: string) => {
  if (position.length !== other.length) {
    throw new MotionInputError(
      `Spring position has ${position.length} components but its ${name} has ${other.length}. Give the position, velocity and target the same number of components.`
    );
  }
};

const snapInto = <Into extends MutableSpring>(into: Into): Into => {
  for (let index = 0; index < into.position.length; index += 1) {
    into.position[index] = into.target[index] ?? 0;
    into.velocity[index] = 0;
  }

  into.remainder = 0;
  into.settled = true;

  return into;
};

const settleIfAtRest = (candidate: MutableSpring<number[]>): Spring =>
  atRest(
    candidate.config,
    candidate.position,
    candidate.velocity,
    candidate.target
  )
    ? snapInto(candidate)
    : candidate;

export interface SpringOptions {
  readonly config: SpringConfig;
  readonly position: Vector;
  readonly target?: Vector;
  readonly velocity?: Vector;
}

export const spring = (options: SpringOptions): Spring => {
  const target = [...(options.target ?? options.position)];

  const velocity = [
    ...(options.velocity ?? Array.from(options.position, () => 0)),
  ];

  requireDimensions(options.position, target, "target");
  requireDimensions(options.position, velocity, "velocity");

  return settleIfAtRest({
    config: options.config,
    kind: "spring",
    position: [...options.position],
    remainder: 0,
    settled: false,
    target,
    velocity,
  });
};

const substepInto = (into: MutableSpring) => {
  const { damping, mass, stiffness } = into.config;

  for (let index = 0; index < into.position.length; index += 1) {
    const position = into.position[index] ?? 0;
    const velocity = into.velocity[index] ?? 0;

    const acceleration =
      (-stiffness * (position - (into.target[index] ?? 0)) -
        damping * velocity) /
      mass;

    const nextVelocity = velocity + acceleration * SUBSTEP_SECONDS;

    into.velocity[index] = nextVelocity;
    into.position[index] = position + nextVelocity * SUBSTEP_SECONDS;
  }
};

const copyInto = (from: Spring | MutableSpring, into: MutableSpring) => {
  if (from === into) {
    return;
  }

  into.config = from.config;
  into.remainder = from.remainder;
  into.settled = from.settled;

  for (let index = 0; index < from.position.length; index += 1) {
    into.position[index] = from.position[index] ?? 0;
    into.velocity[index] = from.velocity[index] ?? 0;
    into.target[index] = from.target[index] ?? 0;
  }
};

export const stepInto = <Into extends MutableSpring>(
  from: Spring | MutableSpring,
  elapsed: number,
  into: Into
): Into => {
  copyInto(from, into);

  if (into.settled) {
    into.remainder = 0;

    return into;
  }

  const span = Math.min(MAX_STEP_MS, Math.max(0, elapsed));
  const ticks = into.remainder + span / SUBSTEP_MS;
  const substeps = Math.floor(ticks + SUBSTEP_GRID_TOLERANCE);

  for (let substep = 0; substep < substeps; substep += 1) {
    substepInto(into);

    if (atRest(into.config, into.position, into.velocity, into.target)) {
      return snapInto(into);
    }
  }

  into.remainder = Math.max(0, ticks - substeps);

  return into;
};

const copyOf = (from: Spring): MutableSpring<number[]> => ({
  config: from.config,
  kind: "spring",
  position: [...from.position],
  remainder: from.remainder,
  settled: from.settled,
  target: [...from.target],
  velocity: [...from.velocity],
});

export const step = (from: Spring, elapsed: number): Spring =>
  stepInto(from, elapsed, copyOf(from));

export const snap = (from: Spring): Spring => snapInto(copyOf(from));

export const retarget = (from: Spring, target: Vector): Spring => {
  requireDimensions(from.position, target, "target");

  return settleIfAtRest({
    ...copyOf(from),
    settled: false,
    target: [...target],
  });
};

export const isSettled = (from: Spring) => from.settled;
