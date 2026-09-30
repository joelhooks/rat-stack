import { toHttpApi } from "@rat-stack/capability/http-api";
import {
  InterestDirectory,
  InterestGate,
  InterestRequest,
  digestsMatch,
} from "@rat-stack/core/interest";
import type { InterestMailer, InterestTokens } from "@rat-stack/core/interest";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer, Option, Schema } from "effect";
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
  registerInterest,
} from "./handlers.js";
import { confirmPage, resultPage } from "./pages.js";

export interface InterestOptions {
  readonly operatorToken?: string | undefined;
  readonly rateLimits?: RateLimits | undefined;
  readonly services: Context.Context<
    InterestDirectory | InterestMailer | InterestTokens
  >;
}

const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, "https://ratstack.sh").origin;

const clientIpOf = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["cf-connecting-ip"] ?? "unknown";

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
  });

const interestApi = toHttpApi("ratstack.sh-interest", interestCapabilities, {
  prefix: "/api",
  provide: [
    {
      failure: Schema.Never,
      from: (request: HttpServerRequest.HttpServerRequest) =>
        Effect.succeed({ ip: clientIpOf(request), origin: originOf(request) }),
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

const notFound = HttpServerResponse.text("Not found.\n", {
  contentType: "text/plain; charset=utf-8",
  status: 404,
});

export const interestRoutes = (options: InterestOptions) => {
  const gate = gateFor(options.rateLimits);

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
      Effect.succeed(
        confirmPage(
          originOf(request),
          new URL(request.url, "https://ratstack.sh").searchParams.get(
            "token"
          ) ?? ""
        )
      )
    ),
    HttpRouter.add("POST", "/tokenmaxx/confirm", (request) =>
      Effect.gen(function* confirmAddress() {
        const params = yield* request.urlParamsBody;

        const answered = yield* confirmInterest
          .handler({ token: formValue(params, "token") ?? "" })
          .pipe(
            Effect.match({
              onFailure: (failure) => ({
                heading: "That link did not work",
                message: failure.message,
                status: 410,
              }),
              onSuccess: ({ message }) => ({
                heading: "You are on the list",
                message,
                status: 200,
              }),
            }),
            Effect.provide(requestFor(request)),
            Effect.provideContext(options.services)
          );

        return resultPage(originOf(request), answered);
      }).pipe(Effect.orDie)
    ),
    HttpRouter.add("GET", "/operator/interest", (request) =>
      Effect.gen(function* readInterest() {
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

        const directory = yield* InterestDirectory;
        const summary = yield* directory.summary;

        return HttpServerResponse.jsonUnsafe(summary, {
          headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
        });
      }).pipe(Effect.provideContext(options.services), Effect.orDie)
    )
  );

  return Layer.mergeAll(apiRoutes, formRoutes);
};
