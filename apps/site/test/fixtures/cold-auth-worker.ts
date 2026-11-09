import * as Cloudflare from "@alchemy.run/cloudflare";
import { d1AuthLayer } from "@rat-stack/auth/d1";
import { FeedbackIdentity } from "@rat-stack/auth/feedback";
import { AuthService } from "@rat-stack/auth/service";
import { DatabaseVendor } from "@rat-stack/database";
import { Data, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";

import { feedbackAuthBuild } from "../../src/auth/build-options.js";
import { privateFeedbackRoutes } from "../../src/auth/private-worker.js";

const databaseVendors = Data.taggedEnum<DatabaseVendor["Service"]>();

export default class ColdAuthWorker extends Cloudflare.Worker<ColdAuthWorker>()(
  "ColdAuthWorker",
  {
    build: feedbackAuthBuild,
    compatibility: { date: "2026-05-28", flags: ["nodejs_compat"] },
    dev: { port: 0 },
    main: import.meta.url,
  },
  Effect.gen(function* coldAuthWorker() {
    const database = yield* Cloudflare.D1.Database("ColdAuthDatabase");

    return yield* Effect.gen(function* authRoutes() {
      const auth = yield* AuthService;
      const identity = yield* FeedbackIdentity;

      const fetch = yield* HttpRouter.toHttpEffect(
        privateFeedbackRoutes(auth, identity)
      ).pipe(Effect.orDie);

      return { fetch };
    }).pipe(
      Effect.provide(
        FeedbackIdentity.layer.pipe(
          Layer.provideMerge(
            d1AuthLayer({
              baseURL: "http://auth.test",
              id: "ColdAuth",
              secret: "cold-auth-test-secret-with-enough-entropy",
            })
          ),
          Layer.provide(
            Layer.succeed(DatabaseVendor, databaseVendors.D1({ database }))
          )
        )
      )
    );
  })
) {}
