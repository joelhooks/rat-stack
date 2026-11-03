import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  advance,
  initialClock,
  isAnimating,
  Message,
  motionSchema,
  motionSubscriptions,
  retargetSpring,
  retargetTween,
  SpringSchema,
  startTween,
  TweenSchema,
} from "../src/foldkit.js";
import type { Motion, MotionMessage } from "../src/foldkit.js";
import { Spring, Tween } from "../src/index.js";
import { between, coordinate } from "./arbitraries.js";

const demoMotion = (target: number): Motion<"fade", "dot"> => ({
  clock: initialClock,
  springs: {
    dot: Spring.spring({
      config: Spring.critical(2),
      position: [0, 0],
      target: [target, -target],
    }),
  },
  tweens: {
    fade: startTween(initialClock, {
      duration: 400,
      easing: "cubicOut",
      from: 0,
      to: 1,
    }),
  },
});

const message = Arbitrary.flatMap(
  Arbitrary.schema(Schema.Boolean),
  (isTick): Arbitrary.Arbitrary<MotionMessage> =>
    isTick
      ? between(-50, 400).pipe(
          Arbitrary.map((elapsed) => Message.TickedFrame({ elapsed }))
        )
      : Arbitrary.schema(Schema.Boolean).pipe(
          Arbitrary.map((isReducedMotion) =>
            Message.ChangedReducedMotion({ isReducedMotion })
          )
        )
);

describe("foldkit adapter", () => {
  it.prop(
    "across any history of frames and preference changes the clock only moves forward by clamped frames, and reduced motion leaves nothing animating",
    {
      history: Arbitrary.array(message, { maxLength: 40 }),
      target: coordinate,
    },
    ({ history, target }) => {
      let motion = demoMotion(target);

      for (const next of history) {
        const before = motion.clock.now;

        motion = advance(motion, next);

        expect(motion.clock.now - before).toBeGreaterThanOrEqual(0);
        expect(motion.clock.now - before).toBeLessThanOrEqual(
          Spring.MAX_STEP_MS
        );

        if (motion.clock.reducedMotion) {
          expect(isAnimating(motion)).toBe(false);
          expect(motion.springs.dot.position).toStrictEqual([target, -target]);
        }
      }
    }
  );

  it("reduced motion makes new tweens and retargets land at once", () => {
    const reduced = advance(
      demoMotion(10),
      Message.ChangedReducedMotion({ isReducedMotion: true })
    );

    const tween = retargetTween(reduced.clock, reduced.tweens.fade, 0.25);
    const spring = retargetSpring(reduced.clock, reduced.springs.dot, [3, 4]);

    expect(Tween.sample(tween, reduced.clock.now)).toBe(0.25);
    expect(spring.position).toStrictEqual([3, 4]);
    expect(
      Tween.isDone(
        startTween(reduced.clock, { duration: 900, from: 0, to: 1 }),
        reduced.clock.now
      )
    ).toBe(true);
  });

  it("frames advance springs while anything still moves", () => {
    const start = demoMotion(100);
    const next = advance(start, Message.TickedFrame({ elapsed: 16 }));

    expect(isAnimating(start)).toBe(true);
    expect(next.clock.now).toBe(16);
    expect(next.springs.dot.position).toStrictEqual(
      Spring.step(start.springs.dot, 16).position
    );
    expect(next.tweens.fade).toBe(start.tweens.fade);
  });

  it("the frame subscription runs only while the model animates", () => {
    const subscriptions = motionSubscriptions<Motion<"fade", "dot">, string>({
      isAnimating,
      toMessage: (motionMessage) => motionMessage._tag,
    });

    expect(
      subscriptions.motionFrame.modelToDependencies(demoMotion(5))
    ).toStrictEqual({ isActive: true });
    expect(
      subscriptions.motionFrame.modelToDependencies(
        advance(
          demoMotion(5),
          Message.ChangedReducedMotion({ isReducedMotion: true })
        )
      )
    ).toStrictEqual({ isActive: false });
  });

  it.effect("motion state round-trips through its Model schema", () =>
    Effect.gen(function* roundTrip() {
      const schema = motionSchema({ springs: ["dot"], tweens: ["fade"] });
      const motion = demoMotion(42);

      const decoded = yield* Schema.decodeEffect(schema)(
        yield* Schema.encodeEffect(schema)(motion)
      );

      expect(decoded).toStrictEqual(motion);
      expect(Schema.is(TweenSchema)(motion.tweens.fade)).toBe(true);
      expect(Schema.is(SpringSchema)(motion.springs.dot)).toBe(true);
      expect(
        Schema.is(TweenSchema)({ ...motion.tweens.fade, easing: "wobbly" })
      ).toBe(false);
    })
  );
});
