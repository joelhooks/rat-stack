import { UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import {
  CafeLetter,
  CafeProject,
  cafeLetters,
} from "@rat-stack/core/contracts";
import type { CafeLetterValue } from "@rat-stack/core/contracts";
import { Schema } from "effect";

import { effectUiHandoff } from "../effect-ui-handoff.js";

export const SelectedLetters = Schema.Array(CafeLetter);

export const DirectoryProps = Schema.Struct({
  projects: Schema.Array(CafeProject),
  selected: SelectedLetters,
});

export const firstLetterToggle = Html.ref("FirstLetterToggle", "button");

export const DirectoryMessage = UiSchema.TaggedEnum({
  ClearedStackLetters: {},
  ToggledStackLetter: { letter: CafeLetter },
});

export const toggleLetter = (
  selected: readonly CafeLetterValue[],
  letter: CafeLetterValue
) =>
  cafeLetters.filter((candidate) =>
    candidate === letter
      ? !selected.includes(candidate)
      : selected.includes(candidate)
  );

export const DirectoryHandoff = effectUiHandoff(DirectoryProps);

export const directoryRootId = "directory-effect-ui";

export const directoryHandoffId = "directory-effect-ui-handoff";
