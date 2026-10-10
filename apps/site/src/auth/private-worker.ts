import { d1AuthLayer } from "@rat-stack/auth/d1";
import { FeedbackIdentity } from "@rat-stack/auth/feedback";
import { AuthService as Auth } from "@rat-stack/auth/service";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as AlchemyHttp from "alchemy/Http";
import * as Namespace from "alchemy/Namespace";
import { CurrentRuntimeContext } from "alchemy/RuntimeContext";
import { Context, Effect, Layer } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpRouter from "effect/http/HttpRouter";

import { feedbackRequests } from "./feedback-access.js";
import { feedbackFoundation } from "./foundation.js";
import { feedbackPrivateApi } from "./private-capabilities.js";
import { feedbackAuthDeployment, LearnFeedbackAuth } from "./private-tag.js";

export const privateFeedbackRoutes = (
  auth: Pick<Auth["Service"], "fetch">,
  identity: FeedbackIdentity["Service"]
) =>
  Layer.mergeAll(
    HttpRouter.add("*", "/auth/*", auth.fetch),
    HttpApiBuilder.layer(feedbackPrivateApi.api).pipe(
      Layer.provide(feedbackPrivateApi.layer),
      Layer.provide(AlchemyHttp.Platform)
    ),
    feedbackRequests(identity)
  );

const makePrivateAuth = () =>
  Effect.gen(function* buildPrivateAuth() {
    const runtime = yield* CurrentRuntimeContext;

    if (runtime !== undefined) {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy intentionally erases exporter layer requirements in its per-event registry.
      runtime.telemetry =
        runtime.telemetry === undefined
          ? Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true)
          : Layer.mergeAll(
              // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The existing registry layer retains SDK-erased requirements until WorkerBridge provides them.
              runtime.telemetry,
              Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true)
            );
    }

    const { database, secret } = yield* feedbackFoundation;

    const services = yield* Layer.build(
      FeedbackIdentity.layer.pipe(
        Layer.provideMerge(
          d1AuthLayer({
            baseURL: "https://ratstack.sh",
            id: "LearnFeedback",
            secret: yield* secret.text,
          })
        ),
        Layer.provide(Layer.succeedContext(database))
      )
    ).pipe(Namespace.set("LearnFeedbackAuth"));

    const routes = privateFeedbackRoutes(
      Context.get(services, Auth),
      Context.get(services, FeedbackIdentity)
    );

    const fetch = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie);

    return { fetch };
  });

type WorkerHost<R> = R extends { readonly Type: "Cloudflare.Worker" }
  ? Cloudflare.Workers.Worker
  : R;

type PrivateAuthEffect = ReturnType<typeof makePrivateAuth>;

export default LearnFeedbackAuth.make(
  {
    ...feedbackAuthDeployment,
    main: import.meta.url,
  },
  // SAFETY: exact-pin Alchemy peer graphs share the Worker context key; only the host requirement is mapped, with all other requirements preserved.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- @effect-diagnostics-next-line unsafeEffectTypeAssertion:off -- Identical Alchemy pins have incompatible recursive host types across pnpm peer graphs.
  Effect.suspend(makePrivateAuth) as Effect.Effect<
    Effect.Success<PrivateAuthEffect>,
    Effect.Error<PrivateAuthEffect>,
    WorkerHost<Effect.Services<PrivateAuthEffect>>
  >
);
