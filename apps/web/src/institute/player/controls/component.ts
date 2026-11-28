import { Command } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Match, Option, Schema } from "effect";

import type { ControlsAction } from "./transport.js";
import {
  ControlsActionSchema,
  decodeRate,
  hasTransport,
  muteAction,
  PlaybackSchema,
  rates,
  TransportAction,
} from "./transport.js";

export const ControlsModel = Schema.Struct({
  playback: PlaybackSchema,
  muted: Schema.Boolean,
  completed: Schema.Boolean,
});

export const Message = Schema.TaggedUnion({
  Changed: { model: ControlsModel },
  Action: { action: ControlsActionSchema },
  ActionSent: {},
});

// @effect-diagnostics-next-line experimentalApiUsage:off -- Bind the command to the transport of this player mount.
export class RunAction extends Command.Service<RunAction>()(
  "institute/RunControl",
  {
    args: { action: ControlsActionSchema },
    mode: "concurrent",
    success: Message.cases.ActionSent,
  }
) {}

const send = (action: ControlsAction) => Message.cases.Action.make({ action });

const displayTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const announceTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);

  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
};

export const Controls = Html.component({
  name: "InstituteControls",
  props: ControlsModel,
  model: ControlsModel,
  message: Message,
}).make({
  init: ({ props }) => props,
  update: ($, message) =>
    Match.value(message).pipe(
      Match.tagsExhaustive({
        Changed: ({ model }) => model,
        Action: ({ action }) => $.run(RunAction.make({ action })),
        ActionSent: () => $.model,
      })
    ),
  view: (h, { playback, completed, muted }) => {
    const { currentMs, durationMs, state, rate } = playback;
    const time = `${displayTime(currentMs)} / ${durationMs === undefined ? "–:––" : displayTime(durationMs)}`;
    const disabled = !hasTransport(playback);
    const playLabel = state === "playing" ? "Pause" : "Play";

    const mediaStatus = Match.value(state).pipe(
      Match.when("unavailable", () => "Playback unavailable"),
      Match.when("failed", () => "Playback failed"),
      Match.orElse(() => (completed ? "Section completed" : ""))
    );

    return h.div
      .class("institute-controls")
      .attrs({ role: "group", "aria-label": "Playback controls" })
      .children(
        h.div.class("institute-controls__actions").children(
          h.button
            .attr("type", "button")
            .disabled(disabled)
            .on("click", send(TransportAction.cases.Toggle.make({})))
            .children(playLabel),
          h.button
            .attrs({ type: "button", "aria-keyshortcuts": "R" })
            .disabled(disabled)
            .on("click", send(TransportAction.cases.Replay.make({})))
            .children("Replay"),
          h.select
            .attr("aria-label", "Playback speed")
            .disabled(disabled)
            .value(String(rate))
            .on("change", ({ value }) => {
              const parsed = decodeRate(Number(value));

              return Option.isSome(parsed)
                ? send(TransportAction.cases.Rate.make({ rate: parsed.value }))
                : undefined;
            })
            .children(
              ...rates.map((speed) =>
                h.option.attr("value", String(speed)).children(`${speed}×`)
              )
            ),
          h.button
            .attrs({ type: "button", "aria-pressed": String(muted) })
            .on("click", send(muteAction.make({})))
            .children("Mute cues"),
          h.span.class("institute-controls__time").children(time)
        ),
        h.input
          .attrs({
            "aria-label": "Seek",
            "aria-valuetext":
              durationMs === undefined
                ? "Duration unknown"
                : `${announceTime(currentMs)} of ${announceTime(durationMs)}`,
            max: String(durationMs ?? 0),
            min: "0",
            step: "any",
            type: "range",
          })
          .disabled(disabled || (durationMs ?? 0) <= 0)
          .value(String(currentMs))
          .on("input", ({ value }) =>
            send(TransportAction.cases.Seek.make({ ms: Number(value) }))
          ),
        h.span.attr("role", "status").children(mediaStatus)
      );
  },
});
