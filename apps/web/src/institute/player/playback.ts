import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  sendAndAwait,
  setupEffect,
} from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Effect, Schema } from "effect";
import { constVoid } from "effect/Function";
import { types } from "xstate";

import type {
  PlayerController,
  PlayerSnapshot,
  PlayerState,
} from "./controller.js";

const signal = Schema.Struct({});

interface MetadataSource extends EventTarget {
  readonly HAVE_METADATA: number;
  readonly readyState: number;
  readonly error: MediaError | null;
}

const loadMetadata = createEffectLogic(
  ({ input }: { readonly input: MetadataSource }) =>
    Effect.callback<undefined, "metadata">((resume) => {
      if (input.readyState >= input.HAVE_METADATA) {
        resume(Effect.undefined);

        return Effect.void;
      }

      if (input.error !== null) {
        resume(Effect.fail("metadata"));

        return Effect.void;
      }

      const cleanup = () => {
        input.removeEventListener("loadedmetadata", loaded);
        input.removeEventListener("error", failed);
      };

      const loaded = () => {
        cleanup();
        resume(Effect.undefined);
      };

      const failed = () => {
        cleanup();
        resume(Effect.fail("metadata"));
      };

      input.addEventListener("loadedmetadata", loaded);
      input.addEventListener("error", failed);

      return Effect.sync(cleanup);
    })
);

export const playbackMachine = setupEffect({
  actors: { loadMetadata },
  schemas: {
    events: {
      ENDED: signal,
      FAILED: signal,
      PAUSED: signal,
      PLAYING: signal,
      SEEKED_PAUSED: signal,
      SEEKED_PLAYING: signal,
      SEEKING: signal,
    },
    context: types<{ readonly audio: MetadataSource }>(),
    input: types<MetadataSource>(),
  },
}).createMachine({
  context: ({ input }) => ({ audio: input }),
  initial: "loading",
  states: {
    ended: {
      on: { PLAYING: { target: "playing" }, SEEKING: { target: "seeking" } },
    },
    failed: { type: "final" },
    loading: {
      invoke: {
        input: ({ context }) => context.audio,
        onDone: { target: "ready" },
        onError: { target: "failed" },
        src: "loadMetadata",
      },
    },
    paused: {
      on: { PLAYING: { target: "playing" }, SEEKING: { target: "seeking" } },
    },
    playing: {
      on: {
        ENDED: { target: "ended" },
        PAUSED: { target: "paused" },
        SEEKING: { target: "seeking" },
      },
    },
    ready: {
      on: { PLAYING: { target: "playing" }, SEEKING: { target: "seeking" } },
    },
    seeking: {
      on: {
        ENDED: { target: "ended" },
        SEEKED_PAUSED: { target: "paused" },
        SEEKED_PLAYING: { target: "playing" },
      },
    },
  },
  on: { FAILED: { target: ".failed" } },
});

export const unavailableController: PlayerController = {
  getSnapshot: () => ({
    currentMs: 0,
    durationMs: undefined,
    rate: 1,
    seeking: false,
    state: "unavailable",
  }),
  pause: constVoid,
  play: constVoid,
  seek: constVoid,
  setRate: constVoid,
  subscribe: (listener) => {
    listener(unavailableController.getSnapshot());

    return constVoid;
  },
};

const playMedia = (audio: HTMLAudioElement, onRejected: () => void) => {
  Effect.runFork(
    Effect.tryPromise(() => audio.play()).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.sync(onRejected),
        onSuccess: () => Effect.void,
      })
    )
  );
};

const seekMedia = (
  actor: EffectActor<typeof playbackMachine>,
  apply: () => void
) => {
  Effect.runFork(
    sendAndAwait(actor, { type: "SEEKING" }).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.void,
        onSuccess: ({ value }) =>
          value === "seeking" ? Effect.sync(apply) : Effect.void,
      })
    )
  );
};

export const openPlayback = Effect.fnUntraced(function* openPlayback(
  audio: HTMLAudioElement,
  url: string,
  onEnded: (() => void) | undefined
) {
  const actor = yield* createEffectActor(playbackMachine, { input: audio });
  yield* watchActor("institutePlayback", actor);
  const view = audio.ownerDocument.defaultView;
  const events = new AbortController();
  const listeners = new Set<(snapshot: PlayerSnapshot) => void>();
  let state: PlayerState = "loading";
  let animation: number | undefined;
  let seekRequest = 0;

  const getSnapshot = (): PlayerSnapshot => ({
    currentMs: audio.currentTime * 1000,
    durationMs: Number.isFinite(audio.duration)
      ? audio.duration * 1000
      : undefined,
    rate: audio.playbackRate,
    seeking: state === "seeking",
    state,
  });

  const publish = () => {
    const snapshot = getSnapshot();

    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const tick = () => {
    publish();
    animation =
      state === "playing" ? view?.requestAnimationFrame(tick) : undefined;
  };

  const cancelFrame = () => {
    if (animation !== undefined) {
      view?.cancelAnimationFrame(animation);
      animation = undefined;
    }
  };

  const subscription = actor.subscribe((snapshot) => {
    const before = state;
    state = snapshot.value;

    if (state === "playing") {
      animation ??= view?.requestAnimationFrame(tick);
    } else {
      cancelFrame();
    }

    if (before !== state) {
      publish();

      if (state === "ended") {
        onEnded?.();
      }
    }
  });

  const listen = (event: string, f: () => void) => {
    audio.addEventListener(event, f, { signal: events.signal });
  };

  listen("playing", () => {
    actor.send({ type: "PLAYING" });
  });
  listen("pause", () => {
    if (!audio.ended) {
      actor.send({ type: "PAUSED" });
    }
  });
  listen("seeking", () => {
    actor.send({ type: "SEEKING" });
  });
  listen("seeked", () => {
    actor.send({ type: audio.paused ? "SEEKED_PAUSED" : "SEEKED_PLAYING" });
  });
  listen("ended", () => {
    actor.send({ type: "ENDED" });
  });
  listen("error", () => {
    actor.send({ type: "FAILED" });
  });
  listen("ratechange", publish);
  listen("durationchange", publish);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      events.abort();
      cancelFrame();
      subscription.unsubscribe();
      listeners.clear();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    })
  );
  audio.preload = "auto";
  audio.src = url;

  const controller: PlayerController = {
    getSnapshot,
    pause: () => {
      if (!events.signal.aborted) {
        audio.pause();
      }
    },
    play: () => {
      if (events.signal.aborted || state === "loading" || state === "failed") {
        return;
      }

      playMedia(audio, () => {
        actor.send({ type: "PAUSED" });
      });
    },
    seek: (ms) => {
      if (
        !events.signal.aborted &&
        Number.isFinite(audio.duration) &&
        Number.isFinite(ms)
      ) {
        const seconds = Math.min(audio.duration, Math.max(0, ms / 1000));

        if (seconds !== audio.currentTime) {
          seekRequest += 1;
          const revision = seekRequest;
          seekMedia(actor, () => {
            if (!events.signal.aborted && revision === seekRequest) {
              audio.currentTime = seconds;
              publish();
            }
          });
        }
      }
    },
    setRate: (rate) => {
      if (!events.signal.aborted && rate >= 0.5 && rate <= 3) {
        audio.playbackRate = rate;
      }
    },
    subscribe: (listener) => {
      if (!events.signal.aborted) {
        listeners.add(listener);
        listener(getSnapshot());
      }

      return () => {
        listeners.delete(listener);
      };
    },
  };

  return controller;
});
