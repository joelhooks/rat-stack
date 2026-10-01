import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import {
  EventSink,
  EventSinkError,
  RawEventSchema,
  RequestBodySchema,
  VISITOR_COOKIE,
  VisitorSalt,
  withEventCapture,
} from "../src/index.js";
import type { IdentityMode, RawEvent } from "../src/index.js";
import { EventSinkMemory, memoryEventsLayer } from "../src/memory.js";
import { queryPairs, word } from "./arbitraries.js";

const Exchange = Schema.Struct({
  html: Schema.Boolean,
  method: Schema.Literals(["GET", "POST"]),
  mode: Schema.Literals(["daily", "persistent"]),
  status: Schema.Literals([200, 201, 302, 404, 410, 422, 500]),
  withCookie: Schema.Boolean,
});

const exchange = Arbitrary.all({
  email: word.pipe(Arbitrary.map((local) => `${local}@example.test`)),
  path: Arbitrary.array(word, { maxLength: 4 }),
  query: queryPairs,
  scenario: Arbitrary.schema(Exchange),
  text: word,
});

type Generated =
  typeof exchange extends Arbitrary.Arbitrary<infer A> ? A : never;

const existingCookie = "0199a3b2-6f1e-7c3d-8a4b-1c2d3e4f5a6b";

const requestFor = (generated: Generated) => {
  const query = new URLSearchParams(generated.query).toString();

  const headers = new Headers({
    accept: generated.scenario.html ? "text/html" : "text/markdown",
    "cf-connecting-ip": "203.0.113.7",
    "cf-ipcountry": "AU",
    host: "ratstack.sh",
    "user-agent": "property-test",
  });

  if (generated.scenario.withCookie) {
    headers.set("cookie", `${VISITOR_COOKIE}=${existingCookie}`);
  }

  return HttpServerRequest.fromWeb(
    new Request(
      `https://ratstack.sh/${generated.path.join("/")}${query === "" ? "" : `?${query}`}`,
      generated.scenario.method === "POST"
        ? {
            body: new URLSearchParams({ email: generated.email }).toString(),
            headers,
            method: "POST",
          }
        : { headers, method: "GET" }
    )
  );
};

const appFor = (generated: Generated) =>
  Effect.succeed(
    HttpServerResponse.text(generated.text, {
      contentType: generated.scenario.html
        ? "text/html; charset=utf-8"
        : "text/markdown; charset=utf-8",
      status: generated.scenario.status,
    })
  );

const capture = (mode: IdentityMode) =>
  withEventCapture({ identityMode: mode, runInBackground: (effect) => effect });

const respond = (generated: Generated) =>
  capture(generated.scenario.mode)(appFor(generated)).pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      requestFor(generated)
    )
  );

const onlyEvent = (events: readonly RawEvent[]) =>
  events.length === 1 && events[0] !== undefined
    ? Effect.succeed(events[0])
    : Effect.die(new Error(`expected one event, got ${events.length}`));

const failingSink = Layer.mergeAll(
  Layer.succeed(EventSink, {
    send: () =>
      Effect.fail(new EventSinkError({ cause: new Error("stream down") })),
  }),
  Layer.succeed(VisitorSalt, { salt: Effect.succeed("property-salt") })
);

describe("request capture", () => {
  it.effect.prop(
    "every response is recorded once, unchanged, and without the request body",
    { generated: exchange },
    ({ generated }) =>
      Effect.gen(function* recordOnce() {
        const response = yield* respond(generated);
        const events = yield* (yield* EventSinkMemory).events;

        expect(response.status).toBe(generated.scenario.status);
        expect(events).toHaveLength(1);

        const event = yield* onlyEvent(events);

        const encoded = JSON.stringify(
          yield* Schema.encodeEffect(RawEventSchema)(event)
        );

        const body = yield* Schema.decodeUnknownEffect(RequestBodySchema)(
          event.body
        );

        expect(encoded).not.toContain(generated.email);
        expect(encoded).not.toContain("203.0.113.7");
        expect(body.status).toBe(generated.scenario.status);
        expect(body.method).toBe(generated.scenario.method);
        expect(body.path).toBe(`/${generated.path.join("/")}`);
        expect(event.identityMode).toBe(generated.scenario.mode);
      }).pipe(Effect.provide(memoryEventsLayer("property-salt")))
  );

  it.effect.prop(
    "the visitor cookie is issued only to persistent HTML visitors who lack one",
    { generated: exchange },
    ({ generated }) =>
      Effect.gen(function* issueCookie() {
        const response = yield* respond(generated);
        const event = yield* onlyEvent(yield* (yield* EventSinkMemory).events);
        const issued = response.cookies.cookies[VISITOR_COOKIE];

        const shouldIssue =
          generated.scenario.mode === "persistent" &&
          generated.scenario.html &&
          !generated.scenario.withCookie;

        expect(issued !== undefined).toBe(shouldIssue);

        if (issued !== undefined) {
          expect(issued.value).toBe(event.anonymousId);
          expect(issued.options?.httpOnly).toBe(true);
        }

        if (
          generated.scenario.mode === "persistent" &&
          generated.scenario.withCookie
        ) {
          expect(event.anonymousId).toBe(existingCookie);
        }
      }).pipe(Effect.provide(memoryEventsLayer("property-salt")))
  );

  it.effect.prop(
    "a failing sink never changes the response",
    { generated: exchange },
    ({ generated }) =>
      Effect.gen(function* sinkDown() {
        const response = yield* respond(generated);

        expect(response.status).toBe(generated.scenario.status);
      }).pipe(Effect.provide(failingSink))
  );
});
