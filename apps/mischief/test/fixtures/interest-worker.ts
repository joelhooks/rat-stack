import { InterestTokens, postShibaMailerLayer } from "@rat-stack/core/interest";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { interestDirectoryLayer } from "../../src/interest/directory.js";
import Interest from "../../src/interest/interest-durable-object.js";
import InterestIndex from "../../src/interest/interest-index-durable-object.js";
import { interestRoutes } from "../../src/interest/routes.js";

export default class InterestWorker extends Cloudflare.Worker<InterestWorker>()(
  "InterestWorker",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 0 },
    main: import.meta.url,
  },
  Effect.gen(function* makeInterestWorker() {
    const interests = yield* Interest;

    const index = yield* InterestIndex;

    const services = yield* Layer.build(
      Layer.mergeAll(
        interestDirectoryLayer(
          (address) => interests.getByName(address),
          () => index.getByName("index")
        ),
        InterestTokens.layer(Redacted.make("local-token-secret")),
        postShibaMailerLayer({
          apiKey: Redacted.make(""),
          cluster: "",
          enabled: false,
          team: "",
        }).pipe(Layer.provide(FetchHttpClient.layer))
      )
    );

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        interestRoutes({ operatorToken: "local-operator-token", services })
      ).pipe(Effect.orDie),
    };
  })
) {}
