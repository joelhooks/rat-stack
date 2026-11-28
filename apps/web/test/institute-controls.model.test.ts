import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import type {
  ControlsTransport,
  Playback,
} from "../src/institute/player/controls/transport.js";
import {
  applyTransportAction,
  TransportAction,
} from "../src/institute/player/controls/transport.js";

const Command = Schema.Struct({
  kind: Schema.Literals(["play", "pause", "seek", "end", "replay"]),
  positionMs: Schema.Int.check(
    Schema.isBetween({ minimum: -10_000, maximum: 20_000 })
  ),
});

type CommandKind = typeof Command.Type.kind;

type Mode = "ready" | "playing" | "paused" | "ended";

interface ReferenceMachine {
  mode: Mode;
}

const transitions = {
  ready: {
    play: "playing",
    pause: "ready",
    seek: "paused",
    end: "ready",
    replay: "playing",
  },
  playing: {
    play: "playing",
    pause: "paused",
    seek: "playing",
    end: "ended",
    replay: "playing",
  },
  paused: {
    play: "playing",
    pause: "paused",
    seek: "paused",
    end: "paused",
    replay: "playing",
  },
  ended: {
    play: "playing",
    pause: "ended",
    seek: "paused",
    end: "ended",
    replay: "playing",
  },
} as const satisfies Record<Mode, Record<CommandKind, Mode>>;

const durationMs = 9000;

const recordingTransport = () => {
  let state: Mode = "ready";
  let currentMs = 0;
  const seeks: number[] = [];

  const transport: ControlsTransport = {
    getSnapshot: (): Playback => ({
      currentMs,
      durationMs,
      state,
      rate: 1,
      seeking: false,
    }),
    pause: () => {
      state = "paused";
    },
    play: () => {
      if (state === "ended") {
        currentMs = 0;
      }

      state = "playing";
    },
    seek: (positionMs) => {
      seeks.push(positionMs);
      currentMs = positionMs;

      if (state !== "playing") {
        state = "paused";
      }
    },
    setRate: (rate) => {
      expect(rate).toBe(1);
    },
    subscribe: (listener) => {
      listener({ currentMs, durationMs, state, rate: 1, seeking: false });

      return () => {
        seeks.length = 0;
      };
    },
  };

  return {
    transport,
    seeks,
    end: () => {
      if (state === "playing") {
        currentMs = durationMs;
        state = "ended";
      }
    },
  };
};

const toggle = TransportAction.cases.Toggle.make({});

const replay = TransportAction.cases.Replay.make({});

const commands = Arbitrary.array(Arbitrary.schema(Command), {
  minLength: 5,
  maxLength: 60,
});

describe("institute controls transport", () => {
  it.prop(
    "keeps controller interactions in bounds over mixed playback histories",
    { history: commands },
    ({ history }) => {
      const { transport, seeks, end } = recordingTransport();
      const model: ReferenceMachine = { mode: "ready" };
      let expectedMs = 0;
      const expectedSeeks: number[] = [];

      const boundary = { kind: "seek", positionMs: durationMs + 1 } as const;

      for (const { kind, positionMs } of [...history, boundary]) {
        const before = model.mode;
        model.mode = transitions[before][kind];

        switch (kind) {
          case "play": {
            if (before !== "playing") {
              applyTransportAction(transport, toggle);
            }

            if (before === "ended") {
              expectedMs = 0;
            }

            break;
          }

          case "pause": {
            if (before === "playing") {
              applyTransportAction(transport, toggle);
            }

            break;
          }

          case "seek": {
            applyTransportAction(
              transport,
              TransportAction.cases.Seek.make({ ms: positionMs })
            );
            expectedMs = positionMs;

            if (positionMs < 0) {
              expectedMs = 0;
            } else if (positionMs > durationMs) {
              expectedMs = durationMs;
            }

            expectedSeeks.push(expectedMs);
            break;
          }

          case "end": {
            end();

            if (before === "playing") {
              expectedMs = durationMs;
            }

            break;
          }

          case "replay": {
            applyTransportAction(transport, replay);
            expectedMs = 0;
            expectedSeeks.push(expectedMs);
            break;
          }

          default: {
            kind satisfies never;
          }
        }

        expect(transport.getSnapshot()).toMatchObject({
          currentMs: expectedMs,
          state: model.mode,
        });
        expect(seeks).toStrictEqual(expectedSeeks);
      }
    }
  );
});
