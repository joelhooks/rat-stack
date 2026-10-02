import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

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

const edgeCf = {
  asOrganization: "Example Networks",
  asn: 64_500,
  city: "Warszawa",
  colo: "WAW",
  continent: "EU",
  country: "PL",
  isEUCountry: "1",
  latitude: "52.22977",
  longitude: "21.01178",
  metroCode: "8675309",
  postalCode: "00-950",
  region: "Mazovia",
  regionCode: "14",
  timezone: "Europe/Warsaw",
} as const;

const withCf = (request: Request) =>
  Object.defineProperty(request, "cf", { value: edgeCf });

const requestFor = (generated: Generated, cf = false) => {
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

  const web = new Request(
    `https://ratstack.sh/${generated.path.join("/")}${query === "" ? "" : `?${query}`}`,
    generated.scenario.method === "POST"
      ? {
          body: new URLSearchParams({ email: generated.email }).toString(),
          headers,
          method: "POST",
        }
      : { headers, method: "GET" }
  );

  return HttpServerRequest.fromWeb(cf ? withCf(web) : web);
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

const capture = (mode: IdentityMode, captureCity = false) =>
  withEventCapture({
    captureCity,
    identityMode: mode,
    runInBackground: (effect) => effect,
  });

const respond = (generated: Generated, cf = false, captureCity = false) =>
  capture(
    generated.scenario.mode,
    captureCity
  )(appFor(generated)).pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      requestFor(generated, cf)
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
        expect(event.server.region).toBeUndefined();
      }).pipe(Effect.provide(memoryEventsLayer("property-salt")))
  );

  it.effect.prop(
    "geography comes from request.cf; coordinates, postal and metro code never land, and city only with the switch",
    { captureCity: Arbitrary.schema(Schema.Boolean), generated: exchange },
    ({ captureCity, generated }) =>
      Effect.gen(function* recordGeo() {
        yield* respond(generated, true, captureCity);

        const event = yield* onlyEvent(yield* (yield* EventSinkMemory).events);

        const encoded = JSON.stringify(
          yield* Schema.encodeEffect(RawEventSchema)(event)
        );

        expect(event.server).toMatchObject({
          asOrganization: "Example Networks",
          asn: 64_500,
          colo: "WAW",
          continent: "EU",
          country: "AU",
          isEUCountry: true,
          region: "Mazovia",
          regionCode: "14",
          timezone: "Europe/Warsaw",
        });

        for (const precise of [
          edgeCf.latitude,
          edgeCf.longitude,
          edgeCf.postalCode,
          edgeCf.metroCode,
        ]) {
          expect(encoded).not.toContain(precise);
        }

        expect(encoded.includes(edgeCf.city)).toBe(captureCity);
        expect(event.server.city).toBe(captureCity ? edgeCf.city : undefined);
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
