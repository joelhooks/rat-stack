import { Spring, Tween } from "@rat-stack/motion";
import * as Motion from "@rat-stack/motion/foldkit";
import { Schema } from "effect";

export const stageWidth = 300;

export const stageHeight = 180;

export const targetIds = [
  "top-left",
  "top",
  "top-right",
  "left",
  "centre",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

export const TargetId = Schema.Literals(targetIds);

export type TargetIdValue = typeof TargetId.Type;

const columns = [40, 150, 260] as const;

const rows = [30, 90, 150] as const;

export const targetPoint = (id: TargetIdValue) => {
  const index = targetIds.indexOf(id);

  return {
    x: columns[index % 3] ?? columns[1],
    y: rows[Math.floor(index / 3)] ?? rows[1],
  };
};

export const galleryDuration = 2400;

export const chaseDuration = 700;

export const chaseEasing = "cubicInOut";

export const MotionState = Motion.motionSchema({
  springs: ["chaser"],
  tweens: ["gallery", "tweenX", "tweenY"],
});

export const Model = Schema.Struct({
  motion: MotionState,
  target: TargetId,
});

export type MotionDemoModel = typeof Model.Type;

const centre = targetPoint("centre");

const restingTween = (at: number) =>
  Tween.finish(
    Tween.tween({
      duration: chaseDuration,
      easing: chaseEasing,
      from: at,
      startedAt: Motion.initialClock.now,
      to: at,
    }),
    Motion.initialClock.now
  );

export const initialModel: MotionDemoModel = {
  motion: {
    clock: Motion.initialClock,
    springs: {
      chaser: Spring.spring({
        config: Spring.critical(1.6, { restDelta: 0.01, restSpeed: 0.01 }),
        position: [centre.x, centre.y],
      }),
    },
    tweens: {
      gallery: Motion.startTween(Motion.initialClock, {
        duration: galleryDuration,
        from: 0,
        to: 1,
      }),
      tweenX: restingTween(centre.x),
      tweenY: restingTween(centre.y),
    },
  },
  target: "centre",
};
