import type { FeedbackGrant } from "@rat-stack/core/learn";
import { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { feedbackAccess } from "./feedback-access.js";
import { feedbackPrivateApi } from "./private-capabilities.js";

type Send = Effect.Success<ReturnType<typeof Cloudflare.Workers.Fetch>>;

export const feedbackBindingAccess = (send: Send) => {
  const makeClient = Effect.gen(function* makeFeedbackClient() {
    const runtime = yield* RuntimeContext;

    const httpClient = HttpClient.make((request) =>
      send(request).pipe(
        Effect.provideService(RuntimeContext, runtime),
        Effect.mapError(
          (reason) => new HttpClientError.HttpClientError({ reason })
        )
      )
    );

    return yield* HttpApiClient.make(feedbackPrivateApi.api, {
      baseUrl: "http://learn-feedback-auth",
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
  });

  const request = makeClient.pipe(
    Effect.flatMap((client) =>
      client.capabilities.feedbackAuthorRequest({ payload: {} })
    ),
    Effect.catchTags({
      BadRequest: Effect.die,
      HttpClientError: Effect.die,
      SchemaError: Effect.die,
    })
  );

  const identity = {
    inspectCredential: (token: string, capability: string) =>
      makeClient.pipe(
        Effect.flatMap((client) =>
          client.capabilities.feedbackAuthorCredential({
            payload: { capability, token },
          })
        ),
        Effect.orDie
      ),
    inspectDevice: (code: string) =>
      makeClient.pipe(
        Effect.flatMap((client) =>
          client.capabilities.feedbackAuthorDevice({ payload: { code } })
        ),
        Effect.catchTags({
          BadRequest: Effect.die,
          HttpClientError: Effect.die,
          SchemaError: Effect.die,
        })
      ),
    issue: (grant: typeof FeedbackGrant.Type) =>
      makeClient.pipe(
        Effect.flatMap((client) =>
          client.capabilities.feedbackAuthorIssue({ payload: grant })
        ),
        Effect.catchTags({
          BadRequest: Effect.die,
          HttpClientError: Effect.die,
          SchemaError: Effect.die,
        })
      ),
    request,
    save: (personId: string, cardId: string, feedback: string) =>
      makeClient.pipe(
        Effect.flatMap((client) =>
          client.capabilities.feedbackAuthorSave({
            payload: { cardId, feedback, personId },
          })
        ),
        Effect.orDie
      ),
  };

  const auth = {
    fetch: Effect.gen(function* forwardPhoneAuth() {
      const incoming = yield* HttpServerRequest.HttpServerRequest;
      const web = yield* HttpServerRequest.toWeb(incoming).pipe(Effect.orDie);

      const response = yield* send(HttpClientRequest.fromWeb(web)).pipe(
        Effect.orDie
      );

      const bytes = yield* response.arrayBuffer.pipe(Effect.orDie);

      return HttpServerResponse.uint8Array(new Uint8Array(bytes), {
        cookies: response.cookies,
        headers: Headers.remove(response.headers, "set-cookie"),
        status: response.status,
      });
    }),
  };

  return feedbackAccess(auth, identity);
};
