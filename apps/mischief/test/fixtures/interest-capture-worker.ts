import {
  SubscriberConfirm,
  InterestMode,
  InterestTokens,
} from "@rat-stack/core/interest";
import { postShibaMailerLayer } from "@rat-stack/subscriber-delivery";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { interestDirectoryLayer } from "../../src/interest/directory.js";
import Interest from "../../src/interest/interest-durable-object.js";
import InterestIndex from "../../src/interest/interest-index-durable-object.js";
import { interestRoutes } from "../../src/interest/routes.js";
import { fakeIntakeLayer } from "./fake-intake.js";

export default class InterestCaptureWorker extends Cloudflare.Worker<InterestCaptureWorker>()(
  "InterestCaptureWorker",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 0 },
    main: import.meta.url,
  },
  Effect.gen(function* makeInterestCaptureWorker() {
    const interests = yield* Interest;

    const index = yield* InterestIndex;

    const services = yield* Layer.build(
      Layer.mergeAll(
        interestDirectoryLayer(
          (address) => interests.getByName(address),
          () => index.getByName("index")
        ),
        InterestTokens.layer(Redacted.make("local-token-secret")),
        fakeIntakeLayer,
        SubscriberConfirm.unconfigured,
        InterestMode.layer("capture"),
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
