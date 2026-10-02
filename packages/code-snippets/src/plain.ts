import { Effect, Layer } from "effect";

import { sourceLines } from "./model.ts";
import type { Token } from "./model.ts";
import { HighlightFault, Highlighter } from "./ports.ts";

export const plainLayer = (
  languages: readonly string[] = [
    "text",
    "markdown",
    "typescript",
    "javascript",
  ]
) =>
  Layer.succeed(
    Highlighter,
    Highlighter.of({
      aliases: () => ({}),
      fingerprint: "plain@1:none",
      languages: () => languages,
      themes: () => ["none"],
      tokens: (source, language) =>
        languages.includes(language)
          ? Effect.succeed(
              sourceLines(source).map((text): Token[] => [
                { fontStyle: 0, role: "ink", text },
              ])
            )
          : Effect.fail(new HighlightFault({ kind: "language" })),
    })
  );
