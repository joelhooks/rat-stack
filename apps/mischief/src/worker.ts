import { InterestMode, InterestTokens } from "@rat-stack/core/interest";
import type { InterestDirectory } from "@rat-stack/core/interest";
import {
  IntakeApplications,
  IntakeErasure,
} from "@rat-stack/core/join-interest";
import { IdentityModeSchema, withEventCapture } from "@rat-stack/events";
import type { EventSink, VisitorSalt } from "@rat-stack/events";
import { Basin, basinFoundation } from "@rat-stack/events/basin";
import { intakeLiveLayer, intakeInstance } from "@rat-stack/intake-live";
import { subscriberDeliveryLayer } from "@rat-stack/subscriber-delivery";
import { Stage } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Schema } from "effect";
import type { Context } from "effect";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { mischiefRoutes, readerResponseHeaders } from "./app.js";
import type { MischiefRouteOptions } from "./app.js";
import { contentAssetsForBuild } from "./asset-deployment.js";
import { staticAssetGeneration } from "./bundled-content.generated.js";
import { mischiefConfigFingerprint } from "./config-fingerprint.js";
import { ContentStore } from "./content-store.js";
import CrashTail from "./crash-tail.js";
import { ErrorPageRenderer, websiteErrorPages } from "./error-page-renderer.js";
import { intakeApplicationsLayer } from "./interest/applications.js";
import { interestDirectoryLayer } from "./interest/directory.js";
import Interest from "./interest/interest-durable-object.js";
import InterestIndex from "./interest/interest-index-durable-object.js";
import { agentSignupLayer } from "./interest/join-layer.js";
import type { AgentSignupOptions } from "./interest/join-layer.js";
import LegacyMcp from "./legacy-mcp/durable-object.js";
import { LEGACY_SESSION_HEADER } from "./legacy-mcp/session.js";
import { privateObservability } from "./observability.js";
import { outerHttpPrivacyRegistration } from "./outer-http-privacy.js";
import { rateLimitsFrom, rateLimitDeclarations } from "./rate-limits.js";
import type { RateLimitBindings } from "./rate-limits.js";
import { withReaderWebsite } from "./reader-website.js";
import {
  logRequestIncident,
  observeRequestIncidents,
} from "./request-incidents.js";
import { layerWorkerLoader, sandboxLimits } from "./sandbox-worker-loader.js";
import type { WorkerLoaderBinding } from "./sandbox-worker-loader.js";
import { AssetBindingSchema, StaticAssets } from "./static-assets.js";

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
  events?: Context.Context<EventSink | VisitorSalt>,
  agentSignup?: AgentSignupOptions
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

    const drovrIntakeUrl = yield* Config.option(
      Config.String("DROVR_INTAKE_URL")
    );

    const drovrApiBase = yield* Config.option(Config.String("DROVR_API_BASE"));

    const drovrAgentIntakeCredential = yield* Config.option(
      Config.Redacted("DROVR_AGENT_INTAKE_CREDENTIAL")
    );

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
            subscriberDeliveryLayer({
              agentIntake: {
                credential: drovrAgentIntakeCredential,
                url: drovrIntakeUrl,
              },
              confirm: {
                base: drovrApiBase,
                credential: drovrIntakeCredential,
              },
              intake: {
                credential: drovrIntakeCredential,
                url: drovrIntakeUrl,
              },
              mailer: {
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
              },
            })
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

    const joinServices =
      agentSignup !== undefined && interestServices !== undefined
        ? yield* Layer.build(agentSignupLayer(agentSignup, interestServices))
        : undefined;

    const applications =
      agentSignup?.applications === undefined || joinServices === undefined
        ? undefined
        : yield* IntakeApplications.pipe(
            Effect.provide(
              agentSignup.applications.pipe(
                Layer.provide(Layer.succeedContext(joinServices))
              )
            )
          );

    const erasure =
      joinServices === undefined
        ? undefined
        : yield* IntakeErasure.pipe(
            Effect.provide(
              IntakeErasure.layer.pipe(
                Layer.provide(Layer.succeedContext(joinServices))
              )
            )
          );

    const assetBinding = Schema.decodeUnknownOption(AssetBindingSchema)(
      environment.ASSETS
    );

    const assets = Option.isNone(assetBinding)
      ? undefined
      : yield* StaticAssets.pipe(
          Effect.provide(StaticAssets.layer(assetBinding.value))
        );

    const contentStore = yield* ContentStore.pipe(
      Effect.provide(
        ContentStore.layer.pipe(
          Layer.provide(
            Layer.succeed(
              StaticAssets,
              assets ??
                Option.getOrElse(
                  yield* Effect.serviceOption(StaticAssets),
                  () => StaticAssets.unavailable
                )
            )
          )
        )
      )
    );

    const workerRoutes = mischiefRoutes({
      assets,
      contentStore,
      interest:
        interest === undefined
          ? undefined
          : { ...interest, applications, erasure },
      joinTokens: interestServices,
      legacyMcp,
      rateLimits,
      staticCache: cloudflareStaticCache,
      webBotAuth: {
        enabled: webBotAuthEnabled,
        privateJwk: webBotAuthPrivateJwk.pipe(
          Option.map(Redacted.value),
          Option.getOrUndefined
        ),
      },
    }).pipe(
      Layer.provide(layerWorkerLoader(loader, sandboxLimits)),
      Layer.provide(
        joinServices === undefined
          ? Layer.empty
          : Layer.succeedContext(joinServices)
      )
    );

    const website = Schema.decodeUnknownEffect(AssetBindingSchema)(
      environment.WEBSITE
    );

    const app = (yield* HttpRouter.toHttpEffect(workerRoutes).pipe(
      Effect.orDie
    )).pipe(
      Effect.provideService(ErrorPageRenderer, websiteErrorPages(website))
    );

    const readerApp = withReaderWebsite(
      website.pipe(Effect.orDie),
      readerResponseHeaders(contentStore)
    )(app);

    return {
      fetch: observeRequestIncidents(
        events === undefined
          ? readerApp
          : withEventCapture({
              captureCity: true,
              identityMode,
              runInBackground: inBackground,
            })(readerApp).pipe(Effect.provideContext(events))
      ),
    };
  });

const makeMischiefWorker = Effect.gen(function* makeMischiefWorker() {
  if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
    yield* Cloudflare.WorkerLoader("CODE_SANDBOX");
  }

  const legacyMcp = yield* LegacyMcp;
  const interests = yield* Interest;
  const interestIndex = yield* InterestIndex;

  const tokenSecret = yield* Config.option(
    Config.Redacted("INTEREST_TOKEN_SECRET")
  );

  const typesafeApiKey = yield* Config.option(
    Config.Redacted("TYPESAFE_API_KEY")
  );

  const agentSignup = Option.isNone(tokenSecret)
    ? undefined
    : ({
        applications: intakeApplicationsLayer(
          () => interestIndex.getByName("index").applicationIds(),
          (actor) => interests.getByName(intakeInstance(actor))
        ),
        contacts: (submissionId: string) =>
          interests.getByName(`join:${submissionId}`),
        intake: intakeLiveLayer({
          interests: (name) => interests.getByName(name),
          tokenSecret: tokenSecret.value,
          typesafeApiKey,
        }).pipe(Layer.provide(FetchHttpClient.layer)),
        noteApplication: (submissionId) =>
          interestIndex.getByName("index").noteApplication(submissionId),
      } satisfies AgentSignupOptions | undefined);

  const eventsEnabled = yield* Config.Boolean("EVENTS_ENABLED").pipe(
    Config.withDefault(false)
  );

  const events = eventsEnabled
    ? yield* Layer.build(Basin({ id: "Mischief" }))
    : yield* basinFoundation({ id: "Mischief" }).pipe(
        Effect.andThen(Effect.succeedNone),
        Effect.map(Option.getOrUndefined)
      );

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
    events,
    agentSignup
  );
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      Cloudflare.Workers.RateLimitBinding,
      outerHttpPrivacyRegistration
    )
  ),
  Effect.tapCause((cause) =>
    logRequestIncident(cause, "initialization").pipe(Effect.asVoid)
  )
);

export default class Mischief extends Cloudflare.Worker<Mischief>()(
  "Mischief",
  Effect.gen(function* mischiefProps() {
    const assets = yield* contentAssetsForBuild(
      new URL("../dist/content", import.meta.url).pathname,
      staticAssetGeneration
    ).pipe(Effect.orDie);

    return {
      assets,
      compatibility: { date: "2026-05-28" },
      dev: { port: 1337 },
      domain: { name: "ratstack.sh", redirects: ["www.ratstack.sh"] },
      env: { MISCHIEF_CONFIG_FINGERPRINT: mischiefConfigFingerprint },
      main: import.meta.url,
      observability: privateObservability,
      tailConsumers: [yield* CrashTail],
    };
  }),
  makeMischiefWorker
) {}
