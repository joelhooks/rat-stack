import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

import {
  InstituteAssetError,
  SectionSchema,
} from "../institute/content/index.js";
import { mountControls } from "../institute/player/controls/index.js";
import type { SectionNavigation } from "../institute/player/controls/index.js";
import { mountInstitutePlayer } from "../institute/player/entry.js";
import type { InstitutePlayerOptions } from "../institute/player/entry.js";
import { preferredAudio } from "../institute/routes/audio-choice.js";
import type { PlayerSlot } from "../institute/routes/hydration.js";

const decodeSection = Schema.decodeEffect(Schema.fromJsonString(SectionSchema));

const chapterAnchors = (host: HTMLElement): SectionNavigation => {
  const page = host.ownerDocument;

  const sections = page.querySelectorAll<HTMLAnchorElement>(
    "[data-institute-section-link]"
  );

  const links = [
    ["first", sections.item(0)],
    ["home", page.querySelector<HTMLAnchorElement>("[data-institute-home]")],
    ["last", sections.item(sections.length - 1)],
    ["next", page.querySelector<HTMLAnchorElement>("[data-institute-next]")],
    [
      "previous",
      page.querySelector<HTMLAnchorElement>("[data-institute-previous]"),
    ],
  ] as const;

  const navigation: Partial<Record<(typeof links)[number][0], () => void>> = {};

  for (const [key, link] of links) {
    if (link !== null) {
      navigation[key] = link.click.bind(link);
    }
  }

  return navigation;
};

export const mountChapter = Effect.fn("institute.mountChapter")(
  function* mountChapter(host: HTMLElement, slot: PlayerSlot) {
    const path = slot.sectionUrl;

    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
    const response = yield* client.get(new URL(path, host.ownerDocument.URL));
    const section = yield* response.text.pipe(Effect.flatMap(decodeSection));

    if (section.id !== slot.sectionId) {
      return yield* new InstituteAssetError({
        cause: `Expected section ${slot.sectionId}, got ${section.id}`,
        path,
      });
    }

    const navigation = chapterAnchors(host);

    const url = preferredAudio(
      host.ownerDocument.createElement("audio"),
      slot.audioUrl,
      slot.audioFallbackUrl
    );

    const options: InstitutePlayerOptions = {
      audioUrl: url,
      chapterId: slot.chapterId,
      mountControls: (controls, controller, keyboardScope) =>
        mountControls(controls, controller, {
          chapterId: slot.chapterId,
          keyboardScope,
          navigation,
          sectionId: slot.sectionId,
        }),
      section,
      sectionId: slot.sectionId,
    };

    return mountInstitutePlayer(
      host,
      navigation.next === undefined
        ? options
        : { ...options, onEnded: navigation.next }
    );
  },
  Effect.provide(FetchHttpClient.layer)
);
