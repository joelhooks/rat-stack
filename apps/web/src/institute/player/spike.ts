import { Effect, Schema } from "effect";

import type { PlayerController } from "./controller.js";
import { mountInstitutePlayer } from "./entry.js";
import { PlayerSectionSchema } from "./section.js";

const chapter = "/one-contract";

const Manifest = Schema.Struct({
  sections: Schema.Array(
    Schema.Struct({
      file: Schema.String.check(
        Schema.isPattern(
          /^define-boundary\.[a-f0-9]+\.json$|^[a-z0-9-]+\.[a-f0-9]+\.json$/u
        )
      ),
      id: Schema.String,
    })
  ),
});

const DraftSection = Schema.Struct({
  ...PlayerSectionSchema.fields,
  audioFile: Schema.String.check(
    Schema.isPattern(/^define-boundary\.[a-f0-9]+\.webm$/u)
  ),
});

const readFixture = Effect.fnUntraced(function* readFixture(
  view: Window,
  name: string
) {
  const response = yield* Effect.tryPromise((signal) =>
    view.fetch(`${chapter}/${name}`, { signal })
  );

  if (!response.ok) {
    return yield* Effect.fail("draft section HTTP failure");
  }

  return yield* Effect.tryPromise(() => response.text());
});

const mountSpikeControls = (host: HTMLElement, player: PlayerController) => {
  const button = host.ownerDocument.createElement("button");
  button.type = "button";
  button.addEventListener("click", () => {
    if (player.getSnapshot().state === "playing") {
      player.pause();
    } else {
      player.play();
    }
  });
  host.append(button);

  return player.subscribe(({ state }) => {
    button.textContent = state === "playing" ? "Pause" : "Play";
    button.disabled = state === "loading" || state === "failed";
  });
};

const start = Effect.fnUntraced(function* start(host: HTMLElement) {
  const view = host.ownerDocument.defaultView;

  if (view === null) {
    return yield* Effect.void;
  }

  const manifestJson = yield* readFixture(view, "manifest.json");

  const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Manifest))(
    manifestJson
  );

  const source = manifest.sections.find(({ id }) => id === "define-boundary");

  if (source === undefined) {
    return yield* Effect.fail("draft manifest omitted define-boundary");
  }

  const sectionJson = yield* readFixture(view, source.file);

  const section = yield* Schema.decodeEffect(
    Schema.fromJsonString(DraftSection)
  )(sectionJson);

  mountInstitutePlayer(host, {
    audioUrl: `${chapter}/${section.audioFile}`,
    chapterId: "one-contract",
    mountControls: mountSpikeControls,
    section,
    sectionId: section.id,
  });

  return yield* Effect.void;
});

export const mountSpike = (host: HTMLElement) => {
  if (import.meta.env.DEV) {
    Effect.runFork(
      start(host).pipe(
        Effect.matchEffect({
          onSuccess: () => Effect.void,
          onFailure: () =>
            Effect.sync(() => {
              host.textContent =
                "Sample unavailable. Start the spike with the compiled draft assets.";
            }),
        })
      )
    );
  }
};
