import { Clock, Crypto, DateTime, Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { EventSink } from "./event-sink.js";
import {
  capturedQuery,
  referrerOf,
  withoutUndefined,
} from "./request-facts.js";
import { RawEventSchema, RequestBodySchema } from "./schemas.js";
import type { IdentityMode } from "./schemas.js";
import { VisitorSalt } from "./visitor-salt.js";
import { VISITOR_COOKIE, resolveVisitor, saltedHash } from "./visitor.js";
import { webCryptoLayer } from "./web-crypto.js";

export interface CaptureOptions<RB> {
  readonly identityMode: IdentityMode;
  readonly runInBackground: (
    effect: Effect.Effect<void>
  ) => Effect.Effect<void, never, RB>;
}

const VISITOR_COOKIE_MAX_AGE = "400 days";

const isHtml = (response: HttpServerResponse.HttpServerResponse) =>
  (response.headers["content-type"] ?? "").startsWith("text/html");

const decodeRequestBody = Schema.decodeUnknownEffect(RequestBodySchema);

const encodeRequestBody = Schema.encodeEffect(RequestBodySchema);

const decodeRawEvent = Schema.decodeUnknownEffect(RawEventSchema);

const recordRequest = <RB>(
  options: CaptureOptions<RB>,
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse,
  startedAt: number,
  finishedAt: number
) =>
  Effect.gen(function* recordRequestEvent() {
    const sink = yield* EventSink;
    const salt = yield* (yield* VisitorSalt).salt;
    const crypto = yield* Crypto.Crypto;
    const { headers } = request;
    const ip = headers["cf-connecting-ip"];
    const userAgent = headers["user-agent"];
    const receivedAt = DateTime.formatIso(DateTime.makeUnsafe(startedAt));
    const url = new URL(request.url, "https://localhost");

    const visitor = yield* resolveVisitor({
      cookie: request.cookies[VISITOR_COOKIE],
      day: receivedAt.slice(0, 10),
      ip,
      mode: options.identityMode,
      salt,
      userAgent,
    });

    const body = yield* decodeRequestBody(
      withoutUndefined({
        accept: headers.accept,
        contentType: response.headers["content-type"],
        durationMs: finishedAt - startedAt,
        method: request.method,
        path: url.pathname,
        query: capturedQuery(url.searchParams),
        referrer: referrerOf(headers.referer),
        signedAgent: headers["signature-agent"] !== undefined,
        status: response.status,
        type: "request",
      })
    );

    const event = yield* decodeRawEvent({
      anonymousId: visitor.anonymousId,
      body: yield* encodeRequestBody(body),
      identityMode: options.identityMode,
      messageId: yield* crypto.randomUUIDv7,
      server: withoutUndefined({
        country: headers["cf-ipcountry"],
        host: headers.host ?? url.host,
        ipHash:
          ip === undefined ? undefined : yield* saltedHash(salt, ["ip", ip]),
        receivedAt,
        userAgent,
      }),
      source: "worker",
      v: 1,
    });

    yield* options.runInBackground(
      sink.send([event]).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("event sink rejected a request event", error)
        ),
        Effect.ignore
      )
    );

    return visitor.issueCookie && isHtml(response)
      ? yield* HttpServerResponse.setCookie(
          response,
          VISITOR_COOKIE,
          visitor.anonymousId,
          {
            httpOnly: true,
            maxAge: VISITOR_COOKIE_MAX_AGE,
            path: "/",
            sameSite: "lax",
            secure: true,
          }
        )
      : response;
  }).pipe(Effect.provide(webCryptoLayer));

export const withEventCapture =
  <RB>(options: CaptureOptions<RB>) =>
  <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    Effect.gen(function* captureRequest() {
      const request = yield* HttpServerRequest.HttpServerRequest;

      if (
        new URL(request.url, "https://localhost").pathname.startsWith(
          "/operator/interest"
        )
      ) {
        return yield* app;
      }

      const startedAt = yield* Clock.currentTimeMillis;
      const response = yield* app;
      const finishedAt = yield* Clock.currentTimeMillis;

      return yield* recordRequest(
        options,
        request,
        response,
        startedAt,
        finishedAt
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("event capture failed", cause).pipe(
            Effect.as(response)
          )
        )
      );
    });
