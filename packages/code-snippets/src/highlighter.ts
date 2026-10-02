import { Context } from "effect";
import type { Effect } from "effect";

import type { HighlightFault } from "./errors/highlight-fault.ts";
import type { Token } from "./tokens.ts";

export class Highlighter extends Context.Service<
  Highlighter,
  {
    readonly fingerprint: string;
    readonly languages: () => readonly string[];
    readonly aliases: () => Readonly<Record<string, string>>;
    readonly themes: () => readonly string[];
    readonly tokens: (
      source: string,
      language: string,
      key: string
    ) => Effect.Effect<readonly (readonly Token[])[], HighlightFault>;
  }
>()("code-snippets/Highlighter") {}
