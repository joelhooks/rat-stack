import { expect, it } from "@effect/vitest";
import { Tween } from "@rat-stack/motion";
import * as Motion from "@rat-stack/motion/foldkit";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { Message } from "../src/client/motion/message.js";
import type { MotionDemoMessage } from "../src/client/motion/message.js";
import {
  initialModel,
  TargetId,
  targetPoint,
} from "../src/client/motion/model.js";
import type { MotionDemoModel } from "../src/client/motion/model.js";
import { isAnimating, update } from "../src/client/motion/update.js";

const step = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("target"), target: TargetId }),
  Schema.Struct({
    elapsed: Schema.Int.check(Schema.isBetween({ maximum: 250, minimum: 0 })),
    kind: Schema.Literal("frame"),
  }),
  Schema.Struct({ kind: Schema.Literal("reduce"), reduced: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("replay") }),
]);

const histories = Arbitrary.schema(
  Schema.Array(step).check(Schema.isMaxLength(40))
);

type Step = typeof step.Type;

const toMessage = (next: Step): MotionDemoMessage => {
  if (next.kind === "target") {
    return Message.ClickedTarget({ target: next.target });
  }

  if (next.kind === "frame") {
    return Message.GotMotionMessage({
      message: Motion.Message.TickedFrame({ elapsed: next.elapsed }),
    });
  }

  if (next.kind === "reduce") {
    return Message.GotMotionMessage({
      message: Motion.Message.ChangedReducedMotion({
        isReducedMotion: next.reduced,
      }),
    });
  }

  return Message.ClickedReplayCurves();
};

const tweenPosition = (current: MotionDemoModel) => [
  Tween.sample(current.motion.tweens.tweenX, current.motion.clock.now),
  Tween.sample(current.motion.tweens.tweenY, current.motion.clock.now),
];

it.prop(
  "across any history both dots chase the last target, the tween dot never jumps, and reduced motion leaves nothing moving",
  { history: histories },
  ({ history }) => {
    let current = initialModel;

    for (const next of history) {
      const previous = current;

      current = update(previous, toMessage(next)).model;

      const point = targetPoint(current.target);

      expect(current.motion.clock.now).toBeGreaterThanOrEqual(
        previous.motion.clock.now
      );
      expect(current.motion.springs.chaser.target).toStrictEqual([
        point.x,
        point.y,
      ]);
      expect([
        current.motion.tweens.tweenX.to,
        current.motion.tweens.tweenY.to,
      ]).toStrictEqual([point.x, point.y]);

      if (next.kind === "target" && !current.motion.clock.reducedMotion) {
        expect(tweenPosition(current)).toStrictEqual(tweenPosition(previous));
      }

      if (current.motion.clock.reducedMotion) {
        expect(isAnimating(current)).toBe(false);
        expect(current.motion.springs.chaser.position).toStrictEqual([
          point.x,
          point.y,
        ]);
      }
    }
  }
);

it("the page opens with one curve sweep running and both dots resting at the centre", () => {
  const centre = targetPoint("centre");

  expect(isAnimating(initialModel)).toBe(true);
  expect(tweenPosition(initialModel)).toStrictEqual([centre.x, centre.y]);
  expect(initialModel.motion.springs.chaser.position).toStrictEqual([
    centre.x,
    centre.y,
  ]);
});
