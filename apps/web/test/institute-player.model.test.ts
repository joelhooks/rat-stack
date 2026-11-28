import { describe, expect, it } from "@effect/vitest";
import { createEffectActor, sendAndAwait, waitFor } from "@xstate/effect";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { playbackMachine } from "../src/institute/player/playback.js";
import { chooseStep } from "../src/institute/player/timeline.js";

class Media extends EventTarget {
  readonly HAVE_METADATA = 1;
  readonly error = null;
  readyState = 0;

  loadMetadata() {
    this.readyState = this.HAVE_METADATA;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
}

const EventName = Schema.Literals([
  "PLAYING",
  "PAUSED",
  "SEEKING",
  "SEEKED_PLAYING",
  "SEEKED_PAUSED",
  "ENDED",
  "FAILED",
]);

type MediaEventName = typeof EventName.Type;

type PlaybackMode =
  | "ready"
  | "playing"
  | "paused"
  | "seeking"
  | "ended"
  | "failed";

const expectedAfter = (
  state: PlaybackMode,
  event: MediaEventName
): PlaybackMode => {
  if (state === "failed" || event === "FAILED") {
    return "failed";
  }

  if (state === "seeking") {
    if (event === "ENDED") {
      return "ended";
    }

    if (event === "SEEKED_PAUSED") {
      return "paused";
    }

    if (event === "SEEKED_PLAYING") {
      return "playing";
    }

    return state;
  }

  if (event === "SEEKING") {
    return "seeking";
  }

  if (event === "PLAYING") {
    return "playing";
  }

  if (state === "playing") {
    if (event === "ENDED") {
      return "ended";
    }

    if (event === "PAUSED") {
      return "paused";
    }
  }

  return state;
};

const histories = Arbitrary.array(Arbitrary.schema(EventName), {
  maxLength: 30,
});

describe("Institute playback", () => {
  it.effect.prop(
    "tracks native readiness and generated playback histories",
    [histories],
    ([history]) =>
      Effect.scoped(
        Effect.gen(function* replayPlayback() {
          const media = new Media();

          const actor = yield* createEffectActor(playbackMachine, {
            input: media,
          });

          expect(actor.getSnapshot().value).toBe("loading");
          media.loadMetadata();
          yield* waitFor(actor, (snapshot) => snapshot.value === "ready");

          let expected: PlaybackMode = "ready";

          for (const event of history) {
            if (expected === "failed") {
              actor.send({ type: event });
              expect(actor.getSnapshot().value).toBe("failed");
            } else {
              expected = expectedAfter(expected, event);
              const snapshot = yield* sendAndAwait(actor, { type: event });

              expect(snapshot.value).toBe(expected);
            }
          }
        })
      )
  );

  it.prop(
    "the last due frame wins at its boundary and after a rewind",
    [
      Arbitrary.array(Arbitrary.schema(Schema.Int), { maxLength: 30 }),
      Arbitrary.schema(Schema.Int),
    ],
    ([times, sample]) => {
      const ordered = [0, ...times.map(Math.abs)].toSorted(
        (left, right) => left - right
      );

      const t = Math.abs(sample);
      const due = ordered.filter((time) => time <= t);

      expect(chooseStep(ordered, t)).toBe(due.length - 1);
      expect(chooseStep(ordered, 0)).toBe(
        ordered.filter((time) => time === 0).length - 1
      );
    }
  );
});
