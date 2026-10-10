import { it } from "@effect/vitest";
import { Cause, Context, Effect, Layer, Logger, Schema, Stream } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { expect } from "vitest";

import { errorPages } from "../src/app.js";
import {
  logRequestIncident,
  observeRequestIncidents,
} from "../src/request-incidents.js";

const ContentFailure = Schema.TaggedStruct("ContentFailure", {
  message: Schema.String,
});

class TestContent extends Context.Service<
  TestContent,
  {
    readonly read: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      typeof ContentFailure.Type
    >;
  }
>()("test/Content") {}

const privateMessage =
  "token=secret cookie=session body=private 203.0.113.9 ?query=hidden";

const withHandler = <E = never>(
  routes: Layer.Layer<
    never,
    never,
    HttpRouter.HttpRouter | HttpRouter.Request<"Error", E>
  >,
  logs: unknown[],
  check: (
    handler: (request: Request) => Effect.Effect<Response>
  ) => Effect.Effect<void, Schema.SchemaError>
) =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        Layer.mergeAll(
          HttpRouter.middleware((app) => observeRequestIncidents(app), {
            global: true,
          }),
          routes
        ).pipe(
          Layer.provideMerge(
            Logger.layer([
              Logger.make(({ message, logLevel }) => {
                if (logLevel === "Error") {
                  logs.push(message);
                }
              }),
            ])
          )
        ),
        { disableLogger: true }
      )
    ),
    ({ handler }) =>
      check((request) =>
        Effect.promise(handler.bind(undefined, request, Context.empty()))
      ),
    ({ dispose }) => Effect.promise(dispose)
  );

const ErrorDiagnostic = Schema.Struct({
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
  name: Schema.String,
});

const Incident = Schema.Struct({
  accept: Schema.Literals([
    "missing",
    "html",
    "markdown",
    "json",
    "wildcard",
    "other",
  ]),
  boundary: Schema.Literals([
    "content",
    "fetch",
    "response-body",
    "initialization",
  ]),
  cause: Schema.String,
  error: Schema.optional(ErrorDiagnostic),
  incidentId: Schema.String,
  kind: Schema.String,
  method: Schema.String,
  route: Schema.String,
  tag: Schema.String,
});

const IncidentLog = Schema.Tuple([
  Schema.Literal("HTTP request incident"),
  Incident,
]);

const generatedHex = Arbitrary.array(
  Arbitrary.schema(
    Schema.Literals([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ])
  ),
  { maxLength: 32, minLength: 32 }
).pipe(Arbitrary.map((characters) => characters.join("")));

const generatedWord = Arbitrary.array(
  Arbitrary.schema(Schema.Literals(["a", "b", "c", "d", "e", "f", "g", "h"])),
  { maxLength: 8, minLength: 1 }
).pipe(Arbitrary.map((characters) => characters.join("")));

const safeDiagnostic = "Cannot perform I/O on behalf of a different request";

it.effect.prop(
  "redacts generated secrets before logging while preserving the diagnostic",
  {
    bearer: generatedHex,
    fragment: generatedWord,
    local: generatedWord,
    secret: generatedHex,
  },
  ({ bearer, fragment, local, secret }) =>
    Effect.gen(function* redactedIncident() {
      const email = `${local}@example.test`;
      const url = `https://example.test/resource?probe=${local}#${fragment}`;
      const message = `${safeDiagnostic}; email ${email}; URL ${url}; Bearer ${bearer}; secret=${secret}`;
      const logs: unknown[] = [];

      yield* logRequestIncident(
        Cause.die(new TypeError(message, { cause: new Error(safeDiagnostic) })),
        "initialization"
      ).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make(({ message: record }) => logs.push(record)),
          ])
        )
      );

      expect(logs).toHaveLength(1);

      const [, record] = yield* Schema.decodeUnknownEffect(IncidentLog)(
        logs[0]
      );

      const encoded = JSON.stringify(logs);

      for (const sensitive of [
        email,
        `?probe=${local}`,
        `#${fragment}`,
        bearer,
        secret,
      ]) {
        expect(encoded).not.toContain(sensitive);
      }

      expect(record.error?.name).toBe("TypeError");
      expect(record.error?.message).toContain(safeDiagnostic);
      expect(record.error?.message).toContain("https://example.test/resource");
      expect(record.error?.message.length).toBeLessThanOrEqual(300);
      expect(record.cause.length).toBeLessThanOrEqual(2048);

      const nested = yield* Schema.decodeUnknownEffect(ErrorDiagnostic)(
        record.error?.cause
      );

      expect(nested.message).toBe(safeDiagnostic);
    })
);

it.effect(
  "bounds native cause chains and withholds typed payloads in either channel",
  () =>
    Effect.gen(function* boundedErrorChain() {
      const logs: unknown[] = [];
      let cause = new Error("deepest secret payload");

      for (let depth = 0; depth < 6; depth += 1) {
        cause = new RangeError(`${safeDiagnostic} ${"detail ".repeat(100)}`, {
          cause,
        });
      }

      yield* logRequestIncident(Cause.fail(cause), "initialization").pipe(
        Effect.provide(
          Logger.layer([Logger.make(({ message }) => logs.push(message))])
        )
      );

      const [, record] = yield* Schema.decodeUnknownEffect(IncidentLog)(
        logs[0]
      );

      let current: unknown = record.error;
      let count = 0;

      while (current !== undefined) {
        const entry =
          yield* Schema.decodeUnknownEffect(ErrorDiagnostic)(current);

        expect(entry.name).toBe("RangeError");
        expect(entry.message).toHaveLength(300);
        current = entry.cause;
        count += 1;
      }

      expect(count).toBe(4);
      expect(JSON.stringify(logs)).not.toContain("deepest secret payload");

      for (const failure of [
        Cause.fail(ContentFailure.make({ message: safeDiagnostic })),
        Cause.die(ContentFailure.make({ message: safeDiagnostic })),
      ]) {
        const typedLogs: unknown[] = [];

        yield* logRequestIncident(failure, "initialization").pipe(
          Effect.provide(
            Logger.layer([
              Logger.make(({ message }) => typedLogs.push(message)),
            ])
          )
        );

        const [, typedRecord] = yield* Schema.decodeUnknownEffect(IncidentLog)(
          typedLogs[0]
        );

        expect(typedRecord.tag).toBe("ContentFailure");
        expect(typedRecord.error).toBeUndefined();
        expect(JSON.stringify(typedLogs)).not.toContain(safeDiagnostic);
      }
    })
);

it.effect(
  "logs initialization defects without inventing HTTP request metadata",
  () =>
    Effect.gen(function* initializationIncident() {
      const logs: unknown[] = [];

      const id = yield* logRequestIncident(
        Cause.die(new ReferenceError(privateMessage)),
        "initialization"
      ).pipe(
        Effect.provide(
          Logger.layer([Logger.make(({ message }) => logs.push(message))])
        )
      );

      expect(logs).toHaveLength(1);

      const [, record] = yield* Schema.decodeUnknownEffect(IncidentLog)(
        logs[0]
      );

      expect(record).toMatchObject({
        accept: "missing",
        boundary: "initialization",
        incidentId: id,
        method: "INIT",
        route: "<initialization>",
        tag: "ReferenceError",
      });
      expect(JSON.stringify(logs)).not.toContain(privateMessage);
    })
);

it.effect(
  "correlates typed content failures and defects without logging request data",
  () =>
    Effect.gen(function* contentIncidents() {
      for (const [failure, tag, kind] of [
        [
          Effect.fail(ContentFailure.make({ message: privateMessage })),
          "ContentFailure",
          "Fail",
        ],
        [Effect.die(new TypeError(privateMessage)), "TypeError", "Die"],
      ] as const) {
        const logs: unknown[] = [];

        const routes = Layer.mergeAll(
          errorPages,
          HttpRouter.add(
            "GET",
            "/lore/:slug",
            TestContent.pipe(
              Effect.flatMap((service) => service.read),
              Effect.provide(Layer.succeed(TestContent, { read: failure }))
            )
          )
        );

        yield* withHandler(routes, logs, (handler) =>
          Effect.gen(function* checkContentIncident() {
            const response = yield* handler(
              new Request(
                "https://example.test/lore/private-slug?query=hidden",
                {
                  headers: {
                    accept: "text/html; private=secret",
                    "cf-connecting-ip": "203.0.113.9",
                    cookie: "session=private",
                  },
                }
              )
            );

            const body = yield* Effect.promise(response.text.bind(response));
            expect(response.status).toBe(500);
            const id = response.headers.get("x-incident-id");
            expect(id).toMatch(/^[a-f0-9-]{36}$/u);
            expect(body).toContain(`Incident id: ${id}`);
            expect(body).not.toContain(privateMessage);
            expect(logs).toHaveLength(1);

            const [, record] = yield* Schema.decodeUnknownEffect(IncidentLog)(
              logs[0]
            );

            expect(record).toMatchObject({
              accept: "html",
              boundary: "content",
              incidentId: id,
              kind,
              method: "GET",
              route: "/lore/:slug",
              tag,
            });
            expect(record.cause).toContain(tag);
            expect(record.cause.length).toBeLessThanOrEqual(2048);
            const serialized = JSON.stringify(logs);

            for (const sensitive of [
              "secret",
              "private-slug",
              "session",
              "203.0.113.9",
              "hidden",
              "body=private",
            ]) {
              expect(serialized).not.toContain(sensitive);
            }
          })
        );
      }
    })
);

it.effect(
  "logs content and machine failures once and preserves non-500 responses",
  () =>
    Effect.gen(function* fetchIncidents() {
      for (const accept of ["text/html", "application/json"]) {
        const logs: unknown[] = [];

        const routes = Layer.mergeAll(
          errorPages,
          HttpRouter.add(
            "GET",
            "/broken/:id",
            Effect.die(new RangeError(privateMessage))
          ),
          HttpRouter.add("GET", "/ok", HttpServerResponse.text("ok"))
        );

        yield* withHandler(routes, logs, (handler) =>
          Effect.gen(function* checkFetchIncident() {
            const response = yield* handler(
              new Request("https://example.test/broken/42", {
                headers: { accept },
              })
            );

            expect(response.status).toBe(500);
            expect(logs).toHaveLength(1);

            const [, record] = yield* Schema.decodeUnknownEffect(IncidentLog)(
              logs[0]
            );

            expect(record.incidentId).toBe(
              response.headers.get("x-incident-id")
            );
            expect(record.tag).toBe("RangeError");

            const ok = yield* handler(new Request("https://example.test/ok"));

            expect(ok.status).toBe(200);
            expect(ok.headers.get("x-incident-id")).toBeNull();
            expect(logs).toHaveLength(1);
          })
        );
      }
    })
);

it.effect("logs failures in middleware outside the content catch-all", () => {
  const logs: unknown[] = [];

  const routes = Layer.mergeAll(
    HttpRouter.add("GET", "/middleware", HttpServerResponse.text("unused")),
    HttpRouter.middleware(
      (app) =>
        HttpServerRequest.HttpServerRequest.pipe(
          Effect.flatMap((request) =>
            request.url.startsWith("/middleware")
              ? Effect.die(new URIError(privateMessage))
              : app
          )
        ),
      { global: true }
    )
  );

  return withHandler(routes, logs, (handler) =>
    Effect.gen(function* checkMiddlewareIncident() {
      const response = yield* handler(
        new Request("https://example.test/middleware?token=secret")
      );

      expect(response.status).toBe(500);
      expect(logs).toHaveLength(1);

      const [, record] = yield* Schema.decodeUnknownEffect(IncidentLog)(
        logs[0]
      );

      expect(record).toMatchObject({
        boundary: "fetch",
        incidentId: response.headers.get("x-incident-id"),
        route: "<unmatched>",
        tag: "URIError",
      });
    })
  );
});

it.effect(
  "correlates an already returned 500 without exposing its body",
  () => {
    const logs: unknown[] = [];

    const routes = HttpRouter.add(
      "GET",
      "/returned",
      HttpServerResponse.text(privateMessage, { status: 500 })
    );

    return withHandler(routes, logs, (handler) =>
      Effect.gen(function* checkReturnedIncident() {
        const response = yield* handler(
          new Request("https://example.test/returned")
        );

        expect(response.status).toBe(500);
        expect(logs).toHaveLength(1);

        const [, record] = yield* Schema.decodeUnknownEffect(IncidentLog)(
          logs[0]
        );

        expect(record).toMatchObject({
          incidentId: response.headers.get("x-incident-id"),
          tag: "ReturnedServerError",
        });
        expect(JSON.stringify(logs)).not.toContain(privateMessage);
      })
    );
  }
);

it.effect(
  "logs a body failure after sending status with the response incident id",
  () => {
    const logs: unknown[] = [];

    const routes = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/stream/:id",
        HttpServerResponse.stream(
          Stream.concat(
            Stream.succeed(new TextEncoder().encode("first")),
            Stream.die(new SyntaxError(privateMessage))
          )
        )
      )
    );

    return withHandler(routes, logs, (handler) =>
      Effect.gen(function* checkBodyIncident() {
        const response = yield* handler(
          new Request("https://example.test/stream/private-id")
        );

        expect(response.status).toBe(200);
        const id = response.headers.get("x-incident-id");
        expect(id).toMatch(/^[a-f0-9-]{36}$/u);

        const result = yield* Effect.tryPromise(
          response.text.bind(response)
        ).pipe(Effect.exit);

        expect(result._tag).toBe("Failure");
        expect(logs).toHaveLength(1);

        const [, record] = yield* Schema.decodeUnknownEffect(IncidentLog)(
          logs[0]
        );

        expect(record).toMatchObject({
          boundary: "response-body",
          incidentId: id,
          route: "/stream/:id",
          tag: "SyntaxError",
        });
        expect(JSON.stringify(logs)).not.toContain(privateMessage);
      })
    );
  }
);
