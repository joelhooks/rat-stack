import { MotionInputError, resolveEasing } from "./easing.pure.js";
import type { EasingSpec } from "./easing.pure.js";
import { mix } from "./interpolate.pure.js";

export interface Tween {
  readonly kind: "tween";
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly easing: EasingSpec;
  readonly startedAt: number;
}

export interface TweenOptions {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly easing?: EasingSpec;
  readonly startedAt: number;
}

export const tween = (options: TweenOptions): Tween => {
  if (!(options.duration >= 0 && Number.isFinite(options.duration))) {
    throw new MotionInputError(
      `Tween duration is ${options.duration} ms. Pass a finite duration of 0 ms or more; 0 jumps straight to the target.`
    );
  }

  resolveEasing(options.easing ?? "linear");

  return {
    duration: options.duration,
    easing: options.easing ?? "linear",
    from: options.from,
    kind: "tween",
    startedAt: options.startedAt,
    to: options.to,
  };
};

export const progress = (animation: Tween, now: number) => {
  const elapsed = now - animation.startedAt;

  if (animation.duration <= 0) {
    return elapsed >= 0 ? 1 : 0;
  }

  return Math.min(1, Math.max(0, elapsed / animation.duration));
};

export const easedProgress = (animation: Tween, now: number) =>
  resolveEasing(animation.easing)(progress(animation, now));

export const sample = (animation: Tween, now: number) =>
  mix(animation.from, animation.to, easedProgress(animation, now));

export const isDone = (animation: Tween, now: number) =>
  progress(animation, now) >= 1;

export const retarget = (animation: Tween, to: number, now: number): Tween => ({
  ...animation,
  from: sample(animation, now),
  startedAt: now,
  to,
});

export const finish = (animation: Tween, now: number): Tween => ({
  ...animation,
  from: animation.to,
  startedAt: now - animation.duration,
});
