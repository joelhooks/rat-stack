import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Website } from "../web/src/website.js";
import { PreviewStage, previewResourcesAllowed } from "./src/preview.js";

export const previewProgram = Effect.gen(function* previewStack() {
  yield* Schema.decodeEffect(PreviewStage)(yield* Stage).pipe(Effect.orDie);
  const website = yield* Website;

  return { websiteUrl: website.url };
});

export default Alchemy.Stack(
  "RatStackPreview",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  previewProgram
).pipe(
  Effect.tap((stack) =>
    previewResourcesAllowed(stack.resources)
      ? Effect.void
      : Effect.die(
          new Error("Preview may declare only Website and RpcBackend Workers")
        )
  )
);
