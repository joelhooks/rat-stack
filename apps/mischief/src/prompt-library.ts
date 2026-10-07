import { PromptLibrary } from "@rat-stack/core";
import { UnknownPrompt } from "@rat-stack/core/contracts";
import { Effect, Layer } from "effect";

import { ContentStore } from "./content-store.js";

export const promptLibraryLayer = Layer.effect(
  PromptLibrary,
  Effect.gen(function* makePromptLibrary() {
    const store = yield* ContentStore;

    return PromptLibrary.of({
      get: (slug) =>
        store.read(`/prompts/${slug}`).pipe(
          Effect.flatMap((resource) =>
            resource.kind === "prompt"
              ? Effect.succeed({
                  body: resource.bodyMarkdown,
                  credit: resource.credit,
                  description: resource.description,
                  slug: resource.slug,
                  title: resource.title,
                })
              : Effect.fail(
                  new UnknownPrompt({
                    message: "Choose a slug returned by listPrompts.",
                    slug,
                  })
                )
          ),
          Effect.catchTag("ResourceNotFound", () =>
            Effect.fail(
              new UnknownPrompt({
                message: "Choose a slug returned by listPrompts.",
                slug,
              })
            )
          )
        ),
      list: store.catalog.pipe(
        Effect.map((catalog) =>
          catalog.resources.flatMap((resource) =>
            resource.kind === "prompt"
              ? [
                  {
                    credit: resource.credit,
                    description: resource.description,
                    slug: resource.slug,
                    title: resource.title,
                  },
                ]
              : []
          )
        )
      ),
    });
  })
);
