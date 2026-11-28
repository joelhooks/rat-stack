import { BrowserHost } from "@effect/ui/html";
import { Effect, Fiber } from "effect";
import { constVoid } from "effect/Function";

import type { PlayerController } from "./controller.js";
import { openPlayback, unavailableController } from "./playback.js";
import type { PlayerSection } from "./section.js";
import { PlayerView, Tick } from "./view.js";

import "./player.css";

export interface InstitutePlayerOptions {
  readonly chapterId: string;
  readonly sectionId: string;
  readonly section: PlayerSection;
  readonly audioUrl: string | undefined;
  readonly onEnded?: () => void;
  readonly mountControls?: (
    host: HTMLElement,
    controller: PlayerController,
    keyboardScope: HTMLElement
  ) => () => void;
}

export const mountInstitutePlayer = (
  host: HTMLElement,
  options: InstitutePlayerOptions
): (() => void) => {
  const page = host.ownerDocument;
  const shell = page.createElement("section");
  shell.className = "institute-player";
  shell.tabIndex = 0;
  shell.setAttribute("aria-label", "Lesson player");
  const controls = page.createElement("div");
  controls.className = "institute-controls";
  const content = page.createElement("div");
  const audio = page.createElement("audio");
  shell.append(controls, content, audio);
  host.replaceChildren(shell);

  let disposed = false;

  const session = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* session() {
        // @effect-diagnostics-next-line experimentalApiUsage:off -- The pinned Effect UI browser host owns the player view scope.
        const root = yield* BrowserHost.mountEffect(
          PlayerView,
          {
            narrated: options.audioUrl !== undefined,
            section: options.section,
          },
          content
        );

        const controller =
          options.audioUrl === undefined
            ? unavailableController
            : yield* openPlayback(audio, options.audioUrl, options.onEnded);

        const stop = controller.subscribe((snapshot) => {
          shell.dataset.state = snapshot.state;
          root.send(Tick.make({ seconds: snapshot.currentMs / 1000 }));
        });

        yield* Effect.addFinalizer(() => Effect.sync(stop));

        if (options.mountControls !== undefined) {
          const activeController: PlayerController = {
            getSnapshot: controller.getSnapshot,
            pause: () => {
              if (!disposed) {
                controller.pause();
              }
            },
            play: () => {
              if (!disposed) {
                controller.play();
              }
            },
            seek: (ms) => {
              if (!disposed) {
                controller.seek(ms);
              }
            },
            setRate: (rate) => {
              if (!disposed) {
                controller.setRate(rate);
              }
            },
            subscribe: (listener) =>
              disposed
                ? constVoid
                : controller.subscribe((snapshot) => {
                    if (!disposed) {
                      listener(snapshot);
                    }
                  }),
          };

          const unmountControls = options.mountControls(
            controls,
            activeController,
            shell
          );

          yield* Effect.addFinalizer(() => Effect.sync(unmountControls));
        }

        return yield* Effect.never;
      })
    )
  );

  return () => {
    disposed = true;
    Effect.runFork(Fiber.interrupt(session));
    shell.remove();
  };
};
