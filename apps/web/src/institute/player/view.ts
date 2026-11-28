import { Html } from "@effect/ui/html";
import { Predicate, Schema } from "effect";

import { codeRuns } from "./code-frame.js";
import { PlayerSectionSchema } from "./section.js";
import { chooseStep, wordParagraphs, wordPhase } from "./timeline.js";

const Props = Schema.Struct({
  narrated: Schema.Boolean,
  section: PlayerSectionSchema,
});

const Model = Schema.Struct({ seconds: Schema.Finite, step: Schema.Finite });

export const Tick = Schema.TaggedStruct("Tick", { seconds: Schema.Finite });

const Step = Schema.TaggedStruct("Step", { step: Schema.Finite });

const Message = Schema.Union([Tick, Step]);

const handOutline =
  "M8 13V4a1.65 1.65 0 0 1 3.3 0v6.5h.4a1.55 1.55 0 0 1 2.9 0h.4a1.55 1.55 0 0 1 2.9.5h.4a1.6 1.6 0 0 1 2.2 1.5V16c0 4-2.55 6-6 6h-1c-2.3 0-3.9-1-5.1-2.6l-3.6-4.6a1.6 1.6 0 0 1 2.2-2.3L8 13Z";

const wordClass = (
  style:
    | {
        readonly bold?: boolean;
        readonly code?: boolean;
        readonly italic?: boolean;
      }
    | undefined
) =>
  [
    style?.bold === true ? "institute-bold" : "",
    style?.code === true ? "institute-inline-code" : "",
    style?.italic === true ? "institute-italic" : "",
  ].join(" ");

export const PlayerView = Html.component({
  message: Message,
  model: Model,
  name: "InstitutePlayerView",
  props: Props,
}).make({
  init: () => ({ seconds: 0, step: 0 }),
  update: ({ model, props }, msg) =>
    Predicate.isTagged(msg, "Tick")
      ? {
          seconds: msg.seconds,
          step: chooseStep(props.section.stepTimes ?? [], msg.seconds),
        }
      : { ...model, step: msg.step },
  view: (h, model) => {
    const { narrated, section } = h.props;
    const data = section.slideshowData;
    const frame = data?.frames[model.step];
    const lines = data?.template.lines;
    const words = section.wordTimings;
    const next = data?.frames[model.step + 1];
    const actualStep = frame === undefined ? 0 : model.step;
    const cursor = frame?.cursor;

    return h.div.class("institute-player-layout").children(
      h.div
        .class("institute-transcript")
        .attr("aria-label", "Transcript")
        .children(
          h.div.class("institute-transcript-card").children(
            words !== undefined && words.length > 0
              ? wordParagraphs(words).map((paragraph) =>
                  h.p.children(
                    paragraph.map(({ word, index }, offset) =>
                      h.span
                        .class(wordClass(word.style))
                        .attrs({
                          "data-phase": narrated
                            ? wordPhase(word, model.seconds, offset === 0)
                            : "static",
                          "data-word": String(index),
                        })
                        .children(`${word.word}${word.suffix ?? " "}`)
                    )
                  )
                )
              : section.text
                  .split(/\n\n+/u)
                  .map((paragraph) => h.p.children(paragraph))
          )
        ),
      frame !== undefined && lines !== undefined
        ? h.div.class("institute-code-panel").children(
            h.pre
              .attr("data-step", String(actualStep))
              .attr("aria-label", "Code walkthrough")
              .children(
                h.code
                  .attr("style", `--line-count:${frame.lineOrder.length}`)
                  .children(
                    frame.lineOrder.map((id, index) => {
                      const line = lines[id];

                      const marks =
                        frame.marks?.filter(
                          (mark) => mark.lineIndex === index
                        ) ?? [];

                      const bright =
                        frame.brightRanges?.filter(
                          (range) => range.lineIndex === index
                        ) ?? [];

                      const runs =
                        line === undefined
                          ? []
                          : codeRuns(line, frame, id, bright);

                      return h.span
                        .key(id)
                        .class("institute-code-line")
                        .attrs({
                          "data-dimmed": String(
                            frame.state[id]?.dimmed === true
                          ),
                          "data-entering": String(
                            frame.state[id]?.entering === true
                          ),
                          "data-line": id,
                          style: `--line-index:${index}`,
                        })
                        .children(
                          ...runs.map((token) =>
                            h.span
                              .key(String(token.start))
                              .attrs({
                                "data-bright": String(token.bright),
                                style: `color:${token.color ?? "inherit"}`,
                              })
                              .children(token.text)
                          ),
                          ...marks.map((mark) =>
                            h.span
                              .class("institute-code-mark")
                              .attrs({
                                "aria-hidden": "true",
                                style: `left:${mark.start}ch;width:${mark.end - mark.start}ch`,
                              })
                              .children()
                          )
                        );
                    }),
                    h.span
                      .key("cursor")
                      .class("institute-code-cursor")
                      .attrs({
                        "aria-hidden": "true",
                        "data-target": String(cursor !== undefined),
                        style:
                          cursor === undefined
                            ? undefined
                            : `--cursor-col:${cursor.charOffset + cursor.textLength / 2};--cursor-row:${cursor.lineIndex + 1}`,
                      })
                      .children(
                        h
                          .el("svg")
                          .attrs({
                            viewBox: "0 0 24 24",
                            fill: "currentColor",
                            focusable: "false",
                          })
                          .children(h.el("path").attr("d", handOutline))
                      )
                  )
              ),
            narrated
              ? null
              : h.div.class("institute-code-controls").children(
                  h.button
                    .attr("type", "button")
                    .attr("disabled", actualStep === 0 ? "" : undefined)
                    .on("click", Step.make({ step: actualStep - 1 }))
                    .children("Previous code step"),
                  h.button
                    .attr("type", "button")
                    .attr("disabled", next === undefined ? "" : undefined)
                    .on("click", Step.make({ step: actualStep + 1 }))
                    .children("Next code step")
                )
          )
        : null
    );
  },
});
