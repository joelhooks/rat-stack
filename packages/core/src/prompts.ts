import { implement } from "@rat-stack/capability/implement";
import { Context, Effect, Layer } from "effect";

import {
  UnknownPrompt,
  getPromptContract,
  listPromptsContract,
} from "./contracts.js";
import type { AssetReadError, Prompt, PromptSummary } from "./contracts.js";

export class PromptLibrary extends Context.Service<
  PromptLibrary,
  {
    readonly list: Effect.Effect<
      readonly (typeof PromptSummary.Type)[],
      AssetReadError
    >;
    readonly get: (
      slug: string
    ) => Effect.Effect<typeof Prompt.Type, AssetReadError | UnknownPrompt>;
  }
>()("rat-stack/PromptLibrary") {
  static readonly layer = (prompts: readonly (typeof Prompt.Type)[]) =>
    Layer.succeed(PromptLibrary, {
      get: (slug) => {
        const prompt = prompts.find((candidate) => candidate.slug === slug);

        return prompt === undefined
          ? Effect.fail(
              new UnknownPrompt({
                message: "Choose a slug returned by listPrompts.",
                slug,
              })
            )
          : Effect.succeed(prompt);
      },
      list: Effect.succeed(
        prompts.map(({ body: _body, ...summary }) => summary)
      ),
    });
}

export const listPrompts = implement(listPromptsContract, () =>
  PromptLibrary.use((library) =>
    library.list.pipe(Effect.map((prompts) => ({ prompts })))
  )
);

export const getPrompt = implement(getPromptContract, ({ slug }) =>
  PromptLibrary.use((library) => library.get(slug))
);
