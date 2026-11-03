import { Record, Schema } from "effect";
import { Dom, Subscription } from "foldkit";
import { defineMessageUnion } from "foldkit/message";

import { isEasingSpec } from "./easing.pure.js";
import * as SpringMotion from "./spring.pure.js";
import type { Spring, SpringConfig } from "./spring.pure.js";
import * as TweenMotion from "./tween.pure.js";
import type { Tween, TweenOptions } from "./tween.pure.js";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const conforms =
  <Value>() =>
  <Codec extends Schema.Schema<Value>>(codec: Codec) =>
    codec;

export const EasingSpecSchema = Schema.String.pipe(
  Schema.refine(isEasingSpec, {
    description:
      "An easing name, cubic-bezier(x1, y1, x2, y2), or steps(count, position)",
  })
);

export const TweenSchema = conforms<Tween>()(
  Schema.Struct({
    duration: Schema.Finite,
    easing: EasingSpecSchema,
    from: Schema.Finite,
    kind: Schema.Literal("tween"),
    startedAt: Schema.Finite,
    to: Schema.Finite,
  })
);

export const SpringConfigSchema = conforms<SpringConfig>()(
  Schema.Struct({
    damping: Schema.Finite,
    mass: Schema.Finite,
    restDelta: Schema.Finite,
    restSpeed: Schema.Finite,
    stiffness: Schema.Finite,
  })
);

export const SpringSchema = conforms<Spring>()(
  Schema.Struct({
    config: SpringConfigSchema,
    kind: Schema.Literal("spring"),
    position: Schema.Array(Schema.Finite),
    remainder: Schema.Finite,
    settled: Schema.Boolean,
    target: Schema.Array(Schema.Finite),
    velocity: Schema.Array(Schema.Finite),
  })
);

export const Clock = Schema.Struct({
  now: Schema.Finite,
  reducedMotion: Schema.Boolean,
});

export type MotionClock = typeof Clock.Type;

export const initialClock: MotionClock = { now: 0, reducedMotion: false };

export const Message = defineMessageUnion({
  ChangedReducedMotion: { isReducedMotion: Schema.Boolean },
  TickedFrame: { elapsed: Schema.Finite },
});

export type MotionMessage = typeof Message.Type;

export interface Motion<
  TweenKey extends string = string,
  SpringKey extends string = string,
> {
  readonly clock: MotionClock;
  readonly tweens: Readonly<Record<TweenKey, Tween>>;
  readonly springs: Readonly<Record<SpringKey, Spring>>;
}

export interface MotionKeys<TweenKey extends string, SpringKey extends string> {
  readonly tweens: readonly TweenKey[];
  readonly springs: readonly SpringKey[];
}

export const motionSchema = <
  const TweenKey extends string,
  const SpringKey extends string,
>(
  keys: MotionKeys<TweenKey, SpringKey>
) =>
  Schema.Struct({
    clock: Clock,
    springs: Schema.Record(Schema.Literals(keys.springs), SpringSchema),
    tweens: Schema.Record(Schema.Literals(keys.tweens), TweenSchema),
  });

export const isAnimating = <TweenKey extends string, SpringKey extends string>(
  motion: Motion<TweenKey, SpringKey>
) =>
  Object.values<Tween>(motion.tweens).some(
    (animation) => !TweenMotion.isDone(animation, motion.clock.now)
  ) ||
  Object.values<Spring>(motion.springs).some(
    (animation) => !SpringMotion.isSettled(animation)
  );

const settleAll = <TweenKey extends string, SpringKey extends string>(
  motion: Motion<TweenKey, SpringKey>
): Motion<TweenKey, SpringKey> => ({
  clock: motion.clock,
  // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Record.map is the Effect record combinator, not Array#map with a thisArg.
  springs: Record.map(motion.springs, SpringMotion.snap),
  // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Record.map is the Effect record combinator, not Array#map with a thisArg.
  tweens: Record.map(motion.tweens, (animation) =>
    TweenMotion.finish(animation, motion.clock.now)
  ),
});

export const advance = <TweenKey extends string, SpringKey extends string>(
  motion: Motion<TweenKey, SpringKey>,
  message: MotionMessage
): Motion<TweenKey, SpringKey> =>
  Message.match<Motion<TweenKey, SpringKey>>(message, {
    ChangedReducedMotion: ({ isReducedMotion }) => {
      const next = {
        ...motion,
        clock: { ...motion.clock, reducedMotion: isReducedMotion },
      };

      return isReducedMotion ? settleAll(next) : next;
    },
    TickedFrame: ({ elapsed }) => {
      const span = Math.min(SpringMotion.MAX_STEP_MS, Math.max(0, elapsed));

      const next = {
        clock: { ...motion.clock, now: motion.clock.now + span },
        // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Record.map is the Effect record combinator, not Array#map with a thisArg.
        springs: Record.map(motion.springs, (animation) =>
          SpringMotion.step(animation, span)
        ),
        tweens: motion.tweens,
      };

      return next.clock.reducedMotion ? settleAll(next) : next;
    },
  });

export const startTween = (
  clock: MotionClock,
  options: Omit<TweenOptions, "startedAt">
): Tween =>
  TweenMotion.tween({
    ...options,
    duration: clock.reducedMotion ? 0 : options.duration,
    startedAt: clock.now,
  });

export const retargetTween = (
  clock: MotionClock,
  animation: Tween,
  to: number
): Tween => {
  const next = TweenMotion.retarget(animation, to, clock.now);

  return clock.reducedMotion ? TweenMotion.finish(next, clock.now) : next;
};

export const retargetSpring = (
  clock: MotionClock,
  animation: Spring,
  target: readonly number[]
): Spring => {
  const next = SpringMotion.retarget(animation, target);

  return clock.reducedMotion ? SpringMotion.snap(next) : next;
};

export interface MotionSubscriptionOptions<Model, Message> {
  readonly isAnimating: (model: Model) => boolean;
  readonly toMessage: (message: MotionMessage) => Message;
}

export const motionSubscriptions = <Model, Message>(
  options: MotionSubscriptionOptions<Model, Message>
) =>
  Subscription.make<Model, Message>()(() => ({
    motionFrame: Subscription.animationFrameEntry<Model, Message>({
      isActive: options.isAnimating,
      toMessage: (elapsed) =>
        options.toMessage(Message.TickedFrame({ elapsed })),
    }),
    reducedMotion: Subscription.persistentEntry(
      Dom.streamFromMediaQuery({
        mapMatches: (isReducedMotion) =>
          options.toMessage(Message.ChangedReducedMotion({ isReducedMotion })),
        query: REDUCED_MOTION_QUERY,
      })
    ),
  }));
