import type { TargetIdValue } from "../../client/motion/model.js";

export const motionCopy = {
  chaseHeading: "Spring and tween",
  chaseIntro:
    "Pick a target. Pick another before the dots arrive. The tween restarts its curve from where it is. The spring keeps its speed and bends toward the new target.",
  galleryHeading: "Curve gallery",
  galleryIntro:
    "Each plot shows one easing over progress from 0 to 1. The dot runs along the curve.",
  replayLabel: "Replay curves",
  springLabel: "Spring dot",
  stageLabel: "Spring dot and tween dot moving toward the chosen target",
  targetsLegend: "Move both dots to",
  tweenLabel: "Tween dot",
} as const;

export const targetNames: Readonly<Record<TargetIdValue, string>> = {
  bottom: "bottom",
  "bottom-left": "bottom left",
  "bottom-right": "bottom right",
  centre: "centre",
  left: "left",
  right: "right",
  top: "top",
  "top-left": "top left",
  "top-right": "top right",
};
