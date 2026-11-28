import { BrowserHost } from "@effect/ui/html";
import { Effect, Fiber, Option, Predicate, Schema } from "effect";

import { Controls, Message, RunAction } from "./component.js";
import { createCueBank } from "./cues.js";
import { attachHotkeys } from "./hotkeys.js";
import type { SectionNavigation } from "./hotkeys.js";
import {
  readPreferences,
  readSectionProgress,
  savePreferences,
  saveSectionProgress,
} from "./progress.js";
import {
  applyTransportAction,
  decodeRate,
  hasTransport,
  muteAction,
  seekTo,
} from "./transport.js";
import type {
  ControlsAction,
  ControlsTransport,
  Playback,
} from "./transport.js";

import "./styles.css";

export { readSectionProgress } from "./progress.js";

export type { SectionNavigation } from "./hotkeys.js";

interface ControlsOptions {
  readonly chapterId: string;
  readonly sectionId: string;
  readonly keyboardScope?: HTMLElement;
  readonly navigation?: SectionNavigation;
}

const isMute = Schema.is(muteAction);

export const mountControls = (
  host: HTMLElement,
  controller: ControlsTransport,
  { chapterId, sectionId, keyboardScope = host, navigation }: ControlsOptions
): (() => void) => {
  const doc = host.ownerDocument;
  const browser = doc.defaultView;
  let preferences = readPreferences(doc);
  let progress = readSectionProgress(doc, chapterId, sectionId);
  let playback = controller.getSnapshot();
  let restored = false;
  let dirty = false;
  let savedSecond = Math.floor(progress.positionMs / 1000);

  const cues = createCueBank(doc, () => preferences.muted);

  const model = () => ({
    completed: progress.completed,
    muted: preferences.muted,
    playback,
  });

  const save = () => {
    if (dirty) {
      saveSectionProgress(doc, chapterId, sectionId, progress);
      savedSecond = Math.floor(progress.positionMs / 1000);
      dirty = false;
    }
  };

  const mount = Effect.scoped(
    Effect.gen(function* mountPlayerControls() {
      const dispatch = (action: ControlsAction): void => {
        if (isMute(action)) {
          preferences = { ...preferences, muted: !preferences.muted };
          savePreferences(doc, preferences);
          cues.setMuted(preferences.muted);
          cues.unlock();
          publishModel();

          return;
        }

        if (!hasTransport(controller.getSnapshot())) {
          return;
        }

        const before = controller.getSnapshot().rate;
        cues.unlock();
        applyTransportAction(controller, action);
        const rate = decodeRate(controller.getSnapshot().rate);

        if (Option.isSome(rate) && rate.value !== preferences.rate) {
          preferences = { ...preferences, rate: rate.value };
          savePreferences(doc, preferences);
        }

        if (Predicate.isTagged(action, "SeekBy")) {
          cues.play("skip");
        } else if (
          Predicate.isTagged(action, "Toggle") ||
          Predicate.isTagged(action, "Replay") ||
          controller.getSnapshot().rate !== before
        ) {
          cues.play("click");
        }
      };

      const commands = RunAction.toLayer(({ action }) =>
        Effect.sync(() => {
          dispatch(action);

          return Message.cases.ActionSent.make({});
        })
      );

      // @effect-diagnostics-next-line experimentalApiUsage:off -- Embedded mount shares the parent player lifetime via Scope.
      const root = yield* BrowserHost.mountEffect(Controls, model(), host, {
        head: false,
      }).pipe(Effect.provide(commands));

      const publishModel = (): void => {
        root.send(Message.cases.Changed.make({ model: model() }));
      };

      const update = (snapshot: Playback) => {
        const previous = playback;
        playback = snapshot;

        if (
          !restored &&
          hasTransport(snapshot) &&
          snapshot.durationMs !== undefined
        ) {
          restored = true;
          const { positionMs } = progress;

          if (positionMs > 0 && positionMs < snapshot.durationMs) {
            seekTo(controller, positionMs);
          }

          controller.setRate(preferences.rate);
          publishModel();

          return;
        }

        const positionChanged = snapshot.currentMs !== previous.currentMs;

        if (
          restored &&
          hasTransport(snapshot) &&
          (!snapshot.seeking || positionChanged)
        ) {
          const ended = snapshot.state === "ended";
          const firstCompletion = ended && !progress.completed;
          const positionMs = ended ? 0 : snapshot.currentMs;

          if (firstCompletion || progress.positionMs !== positionMs) {
            progress = { completed: progress.completed || ended, positionMs };
            dirty = true;
          }

          if (
            firstCompletion ||
            (previous.state !== snapshot.state && dirty) ||
            savedSecond !== Math.floor(positionMs / 1000)
          ) {
            save();
          }

          if (firstCompletion) {
            cues.play("complete");
          }
        }

        publishModel();
      };

      const unsubscribe = controller.subscribe(update);

      const detachKeys = attachHotkeys(
        keyboardScope,
        dispatch,
        navigation,
        () => playback.state === "ended"
      );

      const onVisibility = () => {
        if (doc.visibilityState === "hidden") {
          save();
        }
      };

      browser?.addEventListener("pagehide", save);
      doc.addEventListener("visibilitychange", onVisibility);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unsubscribe();
          detachKeys();
          browser?.removeEventListener("pagehide", save);
          doc.removeEventListener("visibilitychange", onVisibility);
          save();
          cues.dispose();
        })
      );

      return yield* Effect.never;
    })
  );

  const fiber = Effect.runFork(mount);

  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
};
