import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Option } from "effect";

import { feedbackBindingAccess } from "./binding-client.js";
import { feedbackFoundation } from "./foundation.js";
import { LearnFeedbackAuth } from "./private-tag.js";

export const feedbackInfrastructure = Effect.gen(
  function* feedbackInfrastructure() {
    yield* feedbackFoundation;

    const enabled = yield* Config.Boolean("AUTH_ENABLED").pipe(
      Config.withDefault(false)
    );

    if (!enabled) {
      return yield* Effect.succeedNone;
    }

    const backend = yield* LearnFeedbackAuth;
    const send = yield* Cloudflare.Workers.Fetch(backend);

    return Option.some(feedbackBindingAccess(send));
  }
);
