import * as Motion from "@rat-stack/motion/foldkit";
import type { Update } from "foldkit";
import { modifyFields } from "foldkit/struct";

import { Message } from "./message.js";
import type { MotionDemoMessage } from "./message.js";
import { galleryDuration, targetPoint } from "./model.js";
import type { MotionDemoModel, TargetIdValue } from "./model.js";

type UpdateReturn = Update.Return<MotionDemoModel, MotionDemoMessage>;

const chase = (model: MotionDemoModel, target: TargetIdValue) => {
  const { clock, springs, tweens } = model.motion;
  const point = targetPoint(target);

  return {
    ...model.motion,
    springs: {
      chaser: Motion.retargetSpring(clock, springs.chaser, [point.x, point.y]),
    },
    tweens: {
      ...tweens,
      tweenX: Motion.retargetTween(clock, tweens.tweenX, point.x),
      tweenY: Motion.retargetTween(clock, tweens.tweenY, point.y),
    },
  };
};

const replayCurves = (model: MotionDemoModel) => ({
  ...model.motion,
  tweens: {
    ...model.motion.tweens,
    gallery: Motion.startTween(model.motion.clock, {
      duration: galleryDuration,
      from: 0,
      to: 1,
    }),
  },
});

export const isAnimating = (model: MotionDemoModel) =>
  Motion.isAnimating(model.motion);

export const update = (
  model: MotionDemoModel,
  message: MotionDemoMessage
): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedReplayCurves: () => ({
      model: modifyFields(model, { motion: () => replayCurves(model) }),
    }),
    ClickedTarget: ({ target }) => ({
      model: modifyFields(model, {
        motion: () => chase(model, target),
        target: () => target,
      }),
    }),
    GotMotionMessage: ({ message: motionMessage }) => ({
      model: modifyFields(model, {
        motion: () => Motion.advance(model.motion, motionMessage),
      }),
    }),
  });
