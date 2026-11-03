import { Button } from "@foldkit/ui";
import { easingNames, easings, Tween } from "@rat-stack/motion";
import type { EasingName } from "@rat-stack/motion";
import * as stylex from "@stylexjs/stylex";
import { Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../../client/motion/message.js";
import type { MotionDemoMessage } from "../../client/motion/message.js";
import {
  stageHeight,
  stageWidth,
  targetIds,
  targetPoint,
} from "../../client/motion/model.js";
import type {
  MotionDemoModel,
  TargetIdValue,
} from "../../client/motion/model.js";
import { motionCopy, targetNames } from "./copy.js";
import { motionStyles } from "./motion.stylex.js";

const PLOT_SIZE = 100;

const PLOT_SAMPLES = 48;

const className = (style: stylex.StyleXStyles) =>
  stylex.props(style).className ?? "";

const plotY = (value: number) => PLOT_SIZE - value * PLOT_SIZE;

const curvePoints = (name: EasingName) =>
  Array.from({ length: PLOT_SAMPLES + 1 }, (_, index) => {
    const progress = index / PLOT_SAMPLES;

    return `${progress * PLOT_SIZE},${plotY(easings[name](progress))}`;
  }).join(" ");

const curvePlot = (
  name: EasingName,
  progress: number,
  h: HtmlBuilder<MotionDemoMessage>
): Html =>
  h.li(
    [h.Key(name)],
    [
      h.figure(
        [h.Class(className(motionStyles.figure))],
        [
          h.svg(
            [
              h.ViewBox("-6 -45 112 190"),
              h.Role("img"),
              h.AriaLabel(`${name} easing curve`),
              h.Class(className(motionStyles.plot)),
            ],
            [
              h.line([
                h.X1("0"),
                h.Y1(String(PLOT_SIZE)),
                h.X2(String(PLOT_SIZE)),
                h.Y2(String(PLOT_SIZE)),
                h.Class(className(motionStyles.guide)),
              ]),
              h.line([
                h.X1("0"),
                h.Y1("0"),
                h.X2(String(PLOT_SIZE)),
                h.Y2("0"),
                h.Class(className(motionStyles.guide)),
              ]),
              h.polyline([
                h.Points(curvePoints(name)),
                h.Class(className(motionStyles.curve)),
              ]),
              h.circle([
                h.Cx(String(progress * PLOT_SIZE)),
                h.Cy(String(plotY(easings[name](progress)))),
                h.R("5"),
                h.Class(className(motionStyles.dot)),
              ]),
            ]
          ),
          h.figcaption(
            [h.Class(className(motionStyles.caption))],
            [h.code([], [name])]
          ),
        ]
      ),
    ]
  );

const galleryView = (
  model: MotionDemoModel,
  h: HtmlBuilder<MotionDemoMessage>
): Html => {
  const progress = Tween.sample(
    model.motion.tweens.gallery,
    model.motion.clock.now
  );

  return h.section(
    [
      h.AriaLabelledBy("motion-gallery"),
      h.Class(className(motionStyles.section)),
    ],
    [
      h.h2([h.Id("motion-gallery")], [motionCopy.galleryHeading]),
      h.p([], [motionCopy.galleryIntro]),
      Button.view(
        {
          onClick: Message.ClickedReplayCurves(),
          toView: ({ button }) => h.button(button, [motionCopy.replayLabel]),
        },
        h
      ),
      h.ul(
        [h.Class(className(motionStyles.gallery))],
        easingNames.map((name) => curvePlot(name, progress, h))
      ),
    ]
  );
};

const targetMarker = (
  id: TargetIdValue,
  h: HtmlBuilder<MotionDemoMessage>
): Html => {
  const point = targetPoint(id);

  return h.circle([
    h.Key(id),
    h.Cx(String(point.x)),
    h.Cy(String(point.y)),
    h.R("12"),
    h.Class(className(motionStyles.marker)),
  ]);
};

const targetButton = (
  model: MotionDemoModel,
  id: TargetIdValue,
  h: HtmlBuilder<MotionDemoMessage>
): Html =>
  Button.view(
    {
      onClick: Message.ClickedTarget({ target: id }),
      toView: ({ button }) =>
        h.button(
          [...button, h.Key(id), h.AriaPressed(String(model.target === id))],
          [targetNames[id]]
        ),
    },
    h
  );

const chaseView = (
  model: MotionDemoModel,
  h: HtmlBuilder<MotionDemoMessage>
): Html => {
  const { clock, springs, tweens } = model.motion;
  const [springX = 0, springY = 0] = springs.chaser.position;

  return h.section(
    [
      h.AriaLabelledBy("motion-chase"),
      h.Class(className(motionStyles.section)),
    ],
    [
      h.h2([h.Id("motion-chase")], [motionCopy.chaseHeading]),
      h.p([], [motionCopy.chaseIntro]),
      h.svg(
        [
          h.ViewBox(`0 0 ${stageWidth} ${stageHeight}`),
          h.Role("img"),
          h.AriaLabel(motionCopy.stageLabel),
          h.Class(className(motionStyles.stage)),
        ],
        [
          ...targetIds.map((id) => targetMarker(id, h)),
          h.circle([
            h.Cx(String(Tween.sample(tweens.tweenX, clock.now))),
            h.Cy(String(Tween.sample(tweens.tweenY, clock.now))),
            h.R("9"),
            h.Class(className(motionStyles.tween)),
          ]),
          h.rect([
            h.X(String(springX - 6)),
            h.Y(String(springY - 6)),
            h.Width("12"),
            h.Height("12"),
            h.Class(className(motionStyles.spring)),
          ]),
        ]
      ),
      h.p(
        [h.Class(className(motionStyles.legend))],
        [
          h.span([], [`○ ${motionCopy.tweenLabel}`]),
          h.span([], [`■ ${motionCopy.springLabel}`]),
        ]
      ),
      h.fieldset(
        [h.Class(className(motionStyles.targets))],
        [
          h.legend([], [motionCopy.targetsLegend]),
          ...targetIds.map((id) => targetButton(model, id, h)),
        ]
      ),
    ]
  );
};

export const view = Submodel.defineView<MotionDemoModel, MotionDemoMessage>(
  (model, h) => h.div([], [chaseView(model, h), galleryView(model, h)])
);
