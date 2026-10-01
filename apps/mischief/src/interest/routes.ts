import { toHttpApi } from "@rat-stack/capability/http-api";
import {
  InterestDirectory,
  InterestGate,
  InterestMode,
  InterestRequest,
  InterestTokens,
  digestsMatch,
} from "@rat-stack/core/interest";
import type { InterestMailer } from "@rat-stack/core/interest";
import * as AlchemyHttp from "alchemy/Http";
import { Clock, Effect, Layer, Option, Schema, Stream } from "effect";
import type { Context } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as UrlParams from "effect/unstable/http/UrlParams";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import type { RateLimits } from "../rate-limits.js";
import {
  confirmInterest,
  interestCapabilities,
  refusalMessage,
  registerInterest,
} from "./handlers.js";
import { confirmPage, resultPage } from "./pages.js";

export interface InterestOptions {
  readonly operatorToken?: string | undefined;
  readonly rateLimits?: RateLimits | undefined;
  readonly services: Context.Context<
    InterestDirectory | InterestMailer | InterestMode | InterestTokens
  >;
}

const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, "https://ratstack.sh").origin;

const clientIpOf = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["cf-connecting-ip"] ?? "unknown";

const userAgentOf = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["user-agent"] ?? "unknown";

const gateFor = (rateLimits: RateLimits | undefined) =>
  Layer.succeed(InterestGate, {
    allow: (ip: string) =>
      rateLimits === undefined
        ? Effect.succeed(true)
        : rateLimits.limit("INTEREST_PER_IP", ip),
  });

const requestFor = (request: HttpServerRequest.HttpServerRequest) =>
  Layer.succeed(InterestRequest, {
    ip: clientIpOf(request),
    origin: originOf(request),
    userAgent: userAgentOf(request),
  });

const interestApi = toHttpApi("ratstack.sh-interest", interestCapabilities, {
  prefix: "/api",
  provide: [
    {
      failure: Schema.Never,
      from: (request: HttpServerRequest.HttpServerRequest) =>
        Effect.succeed({
          ip: clientIpOf(request),
          origin: originOf(request),
          userAgent: userAgentOf(request),
        }),
      tag: InterestRequest,
    },
  ],
});

const formValue = (params: UrlParams.UrlParams, name: string) =>
  Option.getOrUndefined(UrlParams.getFirst(params, name));

const bearerOf = (request: HttpServerRequest.HttpServerRequest) => {
  const header = request.headers.authorization ?? "";

  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
};

const signupLink = {
  href: "/tokenmaxx#interested",
  label: "Return to signup",
} as const;

const DeleteBody = Schema.Union([
  Schema.Struct({ addresses: Schema.Array(Schema.String) }),
  Schema.Struct({ submissionIds: Schema.Array(Schema.String) }),
]);

const invalidLink = (origin: string) =>
  resultPage(origin, {
    heading: "This link isn't valid",
    link: signupLink,
    message: refusalMessage("invalid"),
    status: 410,
  });

const encoder = new TextEncoder();

const jsonArrayStream = (items: readonly unknown[]) =>
  Stream.fromIterable([
    encoder.encode("[\n"),
    ...items.map((item, position) =>
      encoder.encode(`${position === 0 ? "" : ",\n"}${JSON.stringify(item)}`)
    ),
    encoder.encode("\n]\n"),
  ]);

const notFound = HttpServerResponse.text("Not found.\n", {
  contentType: "text/plain; charset=utf-8",
  status: 404,
});

const operatorHeaders = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
} as const;

export const interestRoutes = (options: InterestOptions) => {
  const gate = gateFor(options.rateLimits);

  const guarded = <E, R>(
    request: HttpServerRequest.HttpServerRequest,
    respond: () => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
  ) =>
    Effect.gen(function* guard() {
      const { operatorToken } = options;

      if (operatorToken === undefined) {
        return notFound;
      }

      if (!(yield* digestsMatch(bearerOf(request), operatorToken))) {
        return HttpServerResponse.text("Unauthorized.\n", {
          contentType: "text/plain; charset=utf-8",
          headers: { "www-authenticate": "Bearer" },
          status: 401,
        });
      }

      return yield* respond();
    }).pipe(Effect.provideContext(options.services), Effect.orDie);

  const apiRoutes = HttpApiBuilder.layer(interestApi.api).pipe(
    Layer.provide(interestApi.layer),
    Layer.provide(gate),
    Layer.provide(Layer.succeedContext(options.services)),
    Layer.provide(AlchemyHttp.Platform)
  );

  const formRoutes = Layer.mergeAll(
    HttpRouter.add("POST", "/tokenmaxx/interest", (request) =>
      Effect.gen(function* submitInterest() {
        const params = yield* request.urlParamsBody;
        const website = formValue(params, "website");

        const answered = yield* registerInterest
          .handler({ email: formValue(params, "email") ?? "", website })
          .pipe(
            Effect.match({
              onFailure: (failure) => ({
                heading: "Check the address",
                message: failure.message,
                status: 422,
              }),
              onSuccess: ({ message }) => ({
                heading: "Check your email",
                message,
                status: 200,
              }),
            }),
            Effect.provide(Layer.merge(requestFor(request), gate)),
            Effect.provideContext(options.services)
          );

        return resultPage(originOf(request), answered);
      }).pipe(Effect.orDie)
    ),
    HttpRouter.add("GET", "/tokenmaxx/confirm", (request) =>
      Effect.gen(function* promptConfirm() {
        if ((yield* InterestMode) === "capture") {
          return invalidLink(originOf(request));
        }

        const token =
          new URL(request.url, "https://ratstack.sh").searchParams.get(
            "token"
          ) ?? "";

        const tokens = yield* InterestTokens;
        const now = yield* Clock.currentTimeMillis;

        return yield* tokens.verify(token, now).pipe(
          Effect.match({
            onFailure: (failure) =>
              resultPage(originOf(request), {
                heading:
                  failure.reason === "expired"
                    ? "This link has expired"
                    : "This link isn't valid",
                link: signupLink,
                message: refusalMessage(
                  failure.reason === "expired" ? "expired" : "invalid"
                ),
                status: 410,
              }),
            onSuccess: () => confirmPage(originOf(request), token),
          })
        );
      }).pipe(Effect.provideContext(options.services), Effect.orDie)
    ),
    HttpRouter.add("POST", "/tokenmaxx/confirm", (request) =>
      Effect.gen(function* confirmAddress() {
        if ((yield* InterestMode) === "capture") {
          return invalidLink(originOf(request));
        }

        const params = yield* request.urlParamsBody;

        const answered = yield* confirmInterest
          .handler({ token: formValue(params, "token") ?? "" })
          .pipe(
            Effect.match({
              onFailure: (failure) => ({
                heading:
                  failure.reason === "expired"
                    ? "This link has expired"
                    : "This link isn't valid",
                link: signupLink,
                message: failure.message,
                status: 410,
              }),
              onSuccess: ({ message }) => ({
                heading: "You're confirmed",
                link: { href: "/", label: "Return to ratstack.sh" },
                message,
                status: 200,
              }),
            }),
            Effect.provide(requestFor(request)),
            Effect.provideContext(options.services)
          );

        return resultPage(originOf(request), answered);
      }).pipe(Effect.provideContext(options.services), Effect.orDie)
    ),
    HttpRouter.add("GET", "/operator/interest", (request) =>
      guarded(request, () =>
        Effect.gen(function* readInterest() {
          const directory = yield* InterestDirectory;

          return HttpServerResponse.jsonUnsafe(yield* directory.summary, {
            headers: operatorHeaders,
          });
        })
      )
    ),
    HttpRouter.add("GET", "/operator/interest/captures", (request) =>
      guarded(request, () =>
        Effect.gen(function* exportCaptures() {
          const directory = yield* InterestDirectory;
          const records = yield* directory.captures;

          return HttpServerResponse.stream(
            jsonArrayStream(
              records.flatMap(({ address, capture }) =>
                capture === undefined
                  ? []
                  : [
                      {
                        address,
                        capturedAt: capture.capturedAt,
                        consentVersion: capture.consentVersion,
                        ipHash: capture.ipHash,
                        submissionId: capture.submissionId,
                        uaHash: capture.uaHash,
                      },
                    ]
              )
            ),
            {
              contentType: "application/json; charset=utf-8",
              headers: operatorHeaders,
            }
          );
        })
      )
    ),
    HttpRouter.add("POST", "/operator/interest/delete", (request) =>
      guarded(request, () =>
        Effect.gen(function* deleteCaptures() {
          const body = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(DeleteBody)),
            Effect.option
          );

          if (Option.isNone(body)) {
            return HttpServerResponse.text("Bad request.\n", {
              contentType: "text/plain; charset=utf-8",
              status: 400,
            });
          }

          const directory = yield* InterestDirectory;

          return HttpServerResponse.jsonUnsafe(
            yield* directory.remove(body.value),
            { headers: operatorHeaders }
          );
        })
      )
    )
  );

  return Layer.mergeAll(apiRoutes, formRoutes);
};
