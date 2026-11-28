import { HtmlHydrate } from "@effect/ui/html";
import { Effect, Schema } from "effect";

import { InstitutePage } from "./component.js";
import {
  InstituteHandoff,
  instituteHandoffId,
  institutePlayerId,
  instituteRootId,
} from "./model.js";

const decodeHandoff = Schema.decodeEffect(
  Schema.fromJsonString(InstituteHandoff)
);

interface PlayerSlot {
  readonly audioUrl: string;
  readonly chapterId: string;
  readonly sectionId: string;
  readonly sectionUrl: string;
}

type MountChapterPlayer = (
  host: HTMLElement,
  slot: PlayerSlot
) => Effect.Effect<() => void>;

export const hydrateInstitute = Effect.fn("institute.hydrate")(
  function* hydrateInstitute(page: Document, mount?: MountChapterPlayer) {
    const container = page.querySelector<HTMLDivElement>(`#${instituteRootId}`);
    const payload = page.querySelector(`#${instituteHandoffId}`);

    if (container === null || payload === null) {
      return null;
    }

    const { props, state } = yield* decodeHandoff(payload.textContent ?? "");

    const root = yield* HtmlHydrate.hydrateEffect(
      InstitutePage,
      props,
      container,
      state
    );

    yield* root.adopted;
    container.dataset.hydrated = "true";

    if (
      props.kind === "chapter" &&
      props.audioUrl !== undefined &&
      mount !== undefined
    ) {
      const host = page.querySelector<HTMLDivElement>(`#${institutePlayerId}`);

      if (host !== null) {
        yield* Effect.acquireRelease(
          mount(host, {
            audioUrl: props.audioUrl,
            chapterId: props.chapter.id,
            sectionId: props.section.id,
            sectionUrl: props.sectionUrl,
          }),
          (dispose) => Effect.sync(dispose)
        );
      }
    }

    return yield* Effect.never;
  }
);
