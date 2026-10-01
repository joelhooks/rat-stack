import {
  InterestMode,
  InterestTokens,
  postShibaMailerLayer,
  drovrConfirmLayer,
  drovrIntakeLayer,
} from "@rat-stack/core/interest";
import type { InterestDirectory } from "@rat-stack/core/interest";
import { IdentityModeSchema, withEventCapture } from "@rat-stack/events";
import type { EventSink, VisitorSalt } from "@rat-stack/events";
import { Basin } from "@rat-stack/events/basin";
import { Stage } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Schema } from "effect";
import type { Context } from "effect";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { mischiefRoutes } from "./app.js";
import type { MischiefRouteOptions } from "./app.js";
import { mischiefConfigFingerprint } from "./config-fingerprint.js";
import { interestDirectoryLayer } from "./interest/directory.js";
import Interest from "./interest/interest-durable-object.js";
import InterestIndex from "./interest/interest-index-durable-object.js";
import LegacyMcp from "./legacy-mcp/durable-object.js";
import { LEGACY_SESSION_HEADER } from "./legacy-mcp/session.js";
import { rateLimitsFrom, rateLimitDeclarations } from "./rate-limits.js";
import type { RateLimitBindings } from "./rate-limits.js";
import { layerWorkerLoader, sandboxLimits } from "./sandbox-worker-loader.js";
import type { WorkerLoaderBinding } from "./sandbox-worker-loader.js";

const cloudflareStaticCache = {
  // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare provides this global only when a request reaches the Worker.
  match: (request: Request) => caches.default.match(request),
  // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare provides this global only when a request reaches the Worker.
  put: (request: Request, response: Response) =>
    caches.default.put(request, response),
};

const inBackground = (effect: Effect.Effect<void>) =>
  Effect.gen(function* registerBackgroundWork() {
    const execution = yield* Cloudflare.WorkerExecutionContext;

    yield* execution.waitUntil(effect);
  });

export const makeMischief = (
  legacyMcp: NonNullable<MischiefRouteOptions["legacyMcp"]>,
  interestDirectory: Layer.Layer<InterestDirectory>,
  events?: Context.Context<EventSink | VisitorSalt>
) =>
  Effect.gen(function* makeMischiefInit() {
    if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
      const stageRateLimits = rateLimitDeclarations(yield* Stage);
      yield* Cloudflare.RateLimit("API_PER_IP", stageRateLimits.API_PER_IP);
      yield* Cloudflare.RateLimit(
        "EXECUTE_GLOBAL",
        stageRateLimits.EXECUTE_GLOBAL
      );
      yield* Cloudflare.RateLimit(
        "EXECUTE_PER_IP",
        stageRateLimits.EXECUTE_PER_IP
      );
      yield* Cloudflare.RateLimit(
        "INTEREST_PER_IP",
        stageRateLimits.INTEREST_PER_IP
      );
    }

    const webBotAuthEnabled = yield* Config.Boolean(
      "WEB_BOT_AUTH_ENABLED"
    ).pipe(Config.withDefault(false));

    const webBotAuthPrivateJwk = yield* Config.option(
      Config.Redacted("WEB_BOT_AUTH_PRIVATE_JWK")
    );

    const interestSendEnabled = yield* Config.Boolean(
      "INTEREST_SEND_ENABLED"
    ).pipe(Config.withDefault(false));

    const interestMode = yield* Config.schema(
      Schema.Literals(["capture", "doi", "drovr"]),
      "INTEREST_MODE"
    ).pipe(Config.withDefault("doi" as const));

    const interestTokenSecret = yield* Config.option(
      Config.Redacted("INTEREST_TOKEN_SECRET")
    );

    const interestOperatorToken = yield* Config.option(
      Config.Redacted("INTEREST_OPERATOR_TOKEN")
    );

    const shieldSiteKey = yield* Config.option(
      Config.String("SHIELD_SHIBA_SITE_KEY")
    );

    const drovrIntakeUrl = yield* Config.option(
      Config.String("DROVR_INTAKE_URL")
    );

    const drovrApiBase = yield* Config.option(Config.String("DROVR_API_BASE"));

    const drovrIntakeCredential = yield* Config.option(
      Config.Redacted("DROVR_INTAKE_CREDENTIAL")
    );

    const postShibaApiKey = yield* Config.option(
      Config.Redacted("POSTSHIBA_API_KEY")
    );

    const postShibaTeam = yield* Config.option(Config.String("POSTSHIBA_TEAM"));

    const postShibaCluster = yield* Config.option(
      Config.String("POSTSHIBA_CLUSTER")
    );

    const identityMode = yield* Config.schema(
      IdentityModeSchema,
      "EVENTS_IDENTITY_MODE"
    ).pipe(Config.withDefault("daily" as const));

    const environment = yield* Cloudflare.WorkerEnvironment;

    // SAFETY: these are the native runtime bindings declared above. Alchemy types the environment as a dictionary it fills in at runtime, so this is the one boundary cast.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const bindings = environment as RateLimitBindings & {
      readonly CODE_SANDBOX: WorkerLoaderBinding;
    };

    const loader = bindings.CODE_SANDBOX;

    const rateLimits = rateLimitsFrom({
      API_PER_IP: bindings.API_PER_IP,
      EXECUTE_GLOBAL: bindings.EXECUTE_GLOBAL,
      EXECUTE_PER_IP: bindings.EXECUTE_PER_IP,
      INTEREST_PER_IP: bindings.INTEREST_PER_IP,
    });

    const interestServices = Option.isNone(interestTokenSecret)
      ? undefined
      : yield* Layer.build(
          Layer.mergeAll(
            interestDirectory,
            InterestTokens.layer(interestTokenSecret.value),
            InterestMode.layer(interestMode),
            drovrIntakeLayer({
              credential: drovrIntakeCredential,
              url: drovrIntakeUrl,
            }).pipe(Layer.provide(FetchHttpClient.layer)),
            drovrConfirmLayer({
              base: drovrApiBase,
              credential: drovrIntakeCredential,
            }).pipe(Layer.provide(FetchHttpClient.layer)),
            postShibaMailerLayer({
              apiKey: Option.getOrElse(postShibaApiKey, () =>
                Redacted.make("")
              ),
              cluster: Option.getOrElse(postShibaCluster, () => ""),
              enabled:
                interestSendEnabled &&
                Option.isSome(postShibaApiKey) &&
                Option.isSome(postShibaTeam) &&
                Option.isSome(postShibaCluster),
              team: Option.getOrElse(postShibaTeam, () => ""),
            }).pipe(Layer.provide(FetchHttpClient.layer))
          )
        );

    const interest =
      interestServices === undefined
        ? undefined
        : {
            operatorToken: interestOperatorToken.pipe(
              Option.map(Redacted.value),
              Option.getOrUndefined
            ),
            services: interestServices,
          };

    const workerRoutes = mischiefRoutes({
      interest,
      legacyMcp,
      rateLimits,
      shieldSiteKey: Option.getOrUndefined(shieldSiteKey),
      staticCache: cloudflareStaticCache,
      webBotAuth: {
        enabled: webBotAuthEnabled,
        privateJwk: webBotAuthPrivateJwk.pipe(
          Option.map(Redacted.value),
          Option.getOrUndefined
        ),
      },
    }).pipe(Layer.provide(layerWorkerLoader(loader, sandboxLimits)));

    const app = yield* HttpRouter.toHttpEffect(workerRoutes).pipe(Effect.orDie);

    return {
      fetch:
        events === undefined
          ? app
          : withEventCapture({ identityMode, runInBackground: inBackground })(
              app
            ).pipe(Effect.provideContext(events)),
    };
  });

const makeMischiefWorker = Effect.gen(function* makeMischiefWorker() {
  if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
    yield* Cloudflare.WorkerLoader("CODE_SANDBOX");
  }

  const legacyMcp = yield* LegacyMcp;
  const interests = yield* Interest;
  const interestIndex = yield* InterestIndex;
  const events = yield* Layer.build(Basin({ id: "Mischief" }));

  return yield* makeMischief(
    {
      forward: (session, request) => {
        const headers = new Headers(request.headers);
        headers.set(LEGACY_SESSION_HEADER, session);

        return legacyMcp
          .getByName(session)
          .fetch(HttpServerRequest.fromWeb(new Request(request, { headers })))
          .pipe(
            Effect.map((response) => HttpServerResponse.toWeb(response)),
            Effect.orDie
          );
      },
    },
    interestDirectoryLayer(
      (address) => interests.getByName(address),
      () => interestIndex.getByName("index")
    ),
    events
  );
}).pipe(Effect.provide(Cloudflare.Workers.RateLimitBinding));

export default class Mischief extends Cloudflare.Worker<Mischief>()(
  "Mischief",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 1337 },
    domain: { name: "ratstack.sh", redirects: ["www.ratstack.sh"] },
    env: { MISCHIEF_CONFIG_FINGERPRINT: mischiefConfigFingerprint },
    main: import.meta.url,
  },
  makeMischiefWorker
) {}
