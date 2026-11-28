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

export interface PlayerSlot {
  readonly audioUrl: string | undefined;
  readonly audioFallbackUrl: string | undefined;
  readonly chapterId: string;
  readonly sectionId: string;
  readonly sectionUrl: string;
}

type MountChapterPlayer<E> = (
  host: HTMLElement,
  slot: PlayerSlot
) => Effect.Effect<() => void, E>;

export const hydrateInstitute = Effect.fn("institute.hydrate")(
  function* hydrateInstitute<E>(page: Document, mount: MountChapterPlayer<E>) {
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

    if (props.kind === "chapter") {
      const host = page.querySelector<HTMLDivElement>(`#${institutePlayerId}`);

      if (host !== null) {
        yield* Effect.acquireRelease(
          mount(host, {
            audioUrl: props.audioUrl,
            audioFallbackUrl: props.audioFallbackUrl,
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
