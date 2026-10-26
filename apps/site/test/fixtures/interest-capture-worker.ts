import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  SubscriberConfirm,
  InterestMode,
  InterestTokens,
} from "@rat-stack/core/interest";
import { Effect, Layer, Redacted } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";

import { interestDirectoryLayer } from "../../src/interest/directory.js";
import Interest from "../../src/interest/interest-durable-object.js";
import InterestIndex from "../../src/interest/interest-index-durable-object.js";
import { retiredInterestRoutes } from "../../src/interest/retired-routes.js";
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
        InterestMode.layer("capture")
      )
    );

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        Layer.merge(
          retiredInterestRoutes,
          interestRoutes({ operatorToken: "local-operator-token", services })
        )
      ).pipe(Effect.orDie),
    };
  })
) {}
