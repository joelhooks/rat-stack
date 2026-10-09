import { CafeProject, cafeLetters } from "@rat-stack/core/contracts";
import type { CafeLetterValue } from "@rat-stack/core/contracts";
import { Schema } from "effect";

import { Model } from "../src/client/cafe/model.js";

const evidenceFor = (
  letters: readonly CafeLetterValue[],
  letter: CafeLetterValue
) => (letters.includes(letter) ? `${letter} evidence in package.json` : null);

const stackFor = (letters: readonly CafeLetterValue[]) => ({
  alchemy: evidenceFor(letters, "alchemy"),
  cloudflare: evidenceFor(letters, "cloudflare"),
  effect: evidenceFor(letters, "effect"),
  foldkit: evidenceFor(letters, "foldkit"),
});

export const cafeProject = (
  title: string,
  letters: readonly CafeLetterValue[]
) =>
  Schema.decodeSync(CafeProject)({
    author: { github: "ada", x: null },
    date: "2026-10-01",
    repo: `ada/${title}`,
    source: `https://github.com/ada/${title}`,
    stack: stackFor(letters),
    stars: null,
    summary: `${title} summary.`,
    title,
    url: `https://github.com/ada/${title}`,
  });

export const fullStack = cafeProject("full-stack", cafeLetters);

export const effectOnly = cafeProject("effect-only", ["effect"]);

export const edgeApp = cafeProject("edge-app", [
  "cloudflare",
  "alchemy",
  "effect",
]);

export const directoryHome = Model.Directory({
  projects: [fullStack, effectOnly, edgeApp],
  selected: [],
});
