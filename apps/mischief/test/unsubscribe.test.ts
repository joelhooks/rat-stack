import { expect, it } from "@effect/vitest";
import { RequestBodySchema, withEventCapture } from "@rat-stack/events";
import { EventSinkMemory, memoryEventsLayer } from "@rat-stack/events/memory";
import {
  Context,
  Effect,
  Fiber,
  Layer,
  Predicate,
  Schema,
  Tracer,
} from "effect";
import { TestClock } from "effect/testing";
import type { HttpClientRequest } from "effect/unstable/http";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { mischiefRoutes } from "../src/app.js";
import {
  UNSUBSCRIBE_QUESTION,
  UNSUBSCRIBE_REFUSED,
  UNSUBSCRIBE_SUCCESS,
} from "../src/interest/unsubscribe-copy.js";
import {
  forwardUnsubscribe,
  UNSUBSCRIBE_PATH,
} from "../src/interest/unsubscribe.js";
import { TestSandbox } from "./test-sandbox.js";

const rawToken = "opaque%2b+%2F%2f%2526%3D";

const upstream = `https://api.drovr.sh/unsubscribe?t=${rawToken}`;

const request = (
  method: "GET" | "POST",
  html = false,
  query = `?extra=drop&t=${rawToken}&other=drop`
) => {
  const url = `https://ratstack.sh${UNSUBSCRIBE_PATH}${query}`;

  const headers = {
    accept: html ? "text/html" : "*/*",
    authorization: "Bearer must-not-forward",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    cookie: "private=must-not-forward",
  };

  return method === "GET"
    ? new Request(url, { headers, method: "GET" })
    : new Request(url, {
        body: "List-Unsubscribe=One-Click",
        headers,
        method: "POST",
      });
};

const routeLayer = (client: HttpClient.HttpClient) =>
  mischiefRoutes().pipe(
    Layer.provide(TestSandbox),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
  );

const serve = Effect.fnUntraced(function* serve(client: HttpClient.HttpClient) {
  const { handler, dispose } = HttpRouter.toWebHandler(routeLayer(client));
  yield* Effect.addFinalizer(() => Effect.promise(dispose));

  return handler;
});

const call = (
  handler: (
    request: Request,
    context?: Context.Context<never>
  ) => Promise<Response>,
  incoming: Request,
  context = Context.empty()
) => Effect.promise(handler.bind(undefined, incoming, context));

const text = (response: Response) =>
  Effect.promise(response.text.bind(response));

it.effect(
  "GET is a private confirmation page and never calls the upstream",
  () =>
    Effect.gen(function* confirmPage() {
      const calls: string[] = [];

      const client = HttpClient.make((outgoing) => {
        calls.push(outgoing.url);

        return Effect.succeed(
          HttpClientResponse.fromWeb(outgoing, new Response("unused"))
        );
      });

      const handler = yield* serve(client);
      const response = yield* call(handler, request("GET", true));
      const body = yield* text(response);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(response.headers.get("content-security-policy")).toContain(
        "form-action 'self'"
      );
      expect(body).toContain('<meta name="robots" content="noindex"');
      expect(body).toContain(
        `<form method="post" action="${UNSUBSCRIBE_PATH}?t=${rawToken}">`
      );
      expect(body).toContain('name="List-Unsubscribe" value="One-Click"');
      expect(body).toContain(UNSUBSCRIBE_QUESTION);
      expect(body).not.toContain("Free workshop");
      expect(body).not.toContain("Apply today");
      expect(body).not.toContain("__INTAKE_PAGE_TICKET__");
      expect(body).not.toContain("<script");

      const missing = yield* text(
        yield* call(handler, request("GET", true, ""))
      );

      expect(missing).toContain(UNSUBSCRIBE_REFUSED.replaceAll("'", "&#39;"));
      expect(missing).not.toContain("<form");
      expect(calls).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "one-click POST preserves raw token, body, content type, response and redirect",
  () =>
    Effect.gen(function* oneClick() {
      const calls: HttpClientRequest.HttpClientRequest[] = [];
      const location = `https://elsewhere.example.test/choose?t=${rawToken}`;

      const client = HttpClient.make((outgoing, url) => {
        calls.push(outgoing);
        expect(url.toString()).toBe(upstream);

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            outgoing,
            new Response("original\nbody", {
              headers: {
                "content-type": "text/plain; charset=UTF-8",
                location,
              },
              status: 302,
            })
          )
        );
      });

      const handler = yield* serve(client);
      const response = yield* call(handler, request("POST"));

      expect(response.status).toBe(302);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=UTF-8"
      );
      expect(response.headers.get("location")).toBe(location);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(yield* text(response)).toBe("original\nbody");
      expect(calls).toHaveLength(1);
      const [outgoing] = calls;
      expect(outgoing?.url).toBe(upstream);
      expect(outgoing?.method).toBe("POST");
      expect(outgoing?.headers.authorization).toBeUndefined();
      expect(outgoing?.headers.cookie).toBeUndefined();
      expect(outgoing?.headers["content-type"]).toBe(
        "application/x-www-form-urlencoded; charset=UTF-8"
      );
      expect(outgoing?.body._tag).toBe("Uint8Array");

      if (
        outgoing !== undefined &&
        Predicate.isTagged(outgoing.body, "Uint8Array")
      ) {
        expect(new TextDecoder().decode(outgoing.body.body)).toBe(
          "List-Unsubscribe=One-Click"
        );
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "opaque POST bytes and an absent content type survive the proxy",
  () =>
    Effect.gen(function* opaqueBytes() {
      const bytes = new Uint8Array([0, 128, 255, 10]);

      const client = HttpClient.make((outgoing) => {
        expect(outgoing.headers["content-type"]).toBeUndefined();
        expect(outgoing.body._tag).toBe("Uint8Array");

        if (Predicate.isTagged(outgoing.body, "Uint8Array")) {
          expect(outgoing.body.body).toEqual(bytes);
        }

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            outgoing,
            new Response(bytes, { status: 207 })
          )
        );
      });

      const handler = yield* serve(client);

      const incoming = new Request(
        `https://ratstack.sh${UNSUBSCRIBE_PATH}?t=${rawToken}`,
        {
          body: bytes,
          method: "POST",
        }
      );

      const response = yield* call(handler, incoming);
      const body = yield* Effect.promise(response.arrayBuffer.bind(response));

      expect(response.status).toBe(207);
      expect(response.headers.get("content-type")).toBeNull();
      expect(new Uint8Array(body)).toEqual(bytes);
    }).pipe(Effect.scoped)
);

it.effect(
  "browser POST renders approved results without changing upstream status",
  () =>
    Effect.gen(function* browserResult() {
      for (const status of [200, 202, 302, 400, 410, 500]) {
        const client = HttpClient.make((outgoing) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              outgoing,
              new Response("upstream body stays private", {
                headers: {
                  location:
                    "https://elsewhere.example.test/never-redirect-browser",
                },
                status,
              })
            )
          )
        );

        const handler = yield* serve(client);
        const response = yield* call(handler, request("POST", true));
        const body = yield* text(response);

        const message =
          status < 300 ? UNSUBSCRIBE_SUCCESS : UNSUBSCRIBE_REFUSED;

        expect(response.status).toBe(status);
        expect(response.headers.get("content-type")).toBe(
          "text/html; charset=utf-8"
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("location")).toBeNull();
        expect(body).toContain(message.replaceAll("'", "&#39;"));
        expect(body).not.toContain("upstream body stays private");
        expect(body).not.toContain("Free workshop");
        expect(body).not.toContain("Apply today");
        expect(body).not.toContain("__INTAKE_PAGE_TICKET__");
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "the fetch transport is manual, credential-free and does not visit Location",
  () =>
    Effect.gen(function* manualFetch() {
      const destinations: string[] = [];
      const options: RequestInit[] = [];

      const client = yield* HttpClient.HttpClient.pipe(
        Effect.provide(
          FetchHttpClient.layer.pipe(
            Layer.provide(
              Layer.succeed(
                FetchHttpClient.Fetch,
                // oxlint-disable-next-line typescript/promise-function-async -- A fake native Fetch boundary returns a Promise, not an Effect.
                (input, init) => {
                  const url = Schema.decodeUnknownSync(Schema.instanceOf(URL))(
                    input
                  );

                  destinations.push(url.href);
                  options.push(init ?? {});

                  return Promise.resolve(
                    new Response("redirect", {
                      headers: {
                        location: "https://different.example.test/never-fetch",
                      },
                      status: 302,
                    })
                  );
                }
              )
            )
          )
        )
      );

      const handler = yield* serve(client);
      const response = yield* call(handler, request("POST"));

      expect(response.status).toBe(302);
      expect(destinations).toEqual([upstream]);
      expect(options[0]?.redirect).toBe("manual");
      expect(options[0]?.credentials).toBe("omit");
      expect(options[0]?.body).toBeInstanceOf(Uint8Array);
    }).pipe(Effect.scoped)
);

it.effect("transport failure is a generic private 502", () =>
  Effect.gen(function* unreachable() {
    const client = HttpClient.make((outgoing) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            cause: `private:${rawToken}`,
            request: outgoing,
          }),
        })
      )
    );

    const handler = yield* serve(client);
    const response = yield* call(handler, request("POST"));
    const body = yield* text(response);

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toBe(
      '{"title":"Unable to complete this request","type":"about:blank"}'
    );
    expect(body).not.toContain(rawToken);
    expect(body).not.toContain("private");
  }).pipe(Effect.scoped)
);

it.effect("the ten-second deadline also protects a hanging upstream", () =>
  Effect.gen(function* deadline() {
    const client = HttpClient.make(() => Effect.never);
    const incoming = HttpServerRequest.fromWeb(request("POST"));

    const pending = yield* forwardUnsubscribe(client, incoming).pipe(
      Effect.forkChild
    );

    yield* TestClock.adjust("10 seconds");
    const response = yield* Fiber.join(pending);
    const web = HttpServerResponse.toWeb(response);

    expect(web.status).toBe(502);
    expect(web.headers.get("cache-control")).toBe("no-store");
    expect(yield* text(web)).not.toContain(rawToken);
  }).pipe(Effect.scoped)
);

it.effect("HTTP tracing never records the private unsubscribe URL", () =>
  Effect.gen(function* privateTracing() {
    const spans: Tracer.NativeSpan[] = [];

    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);

        return span;
      },
    });

    const client = HttpClient.make((outgoing) =>
      Effect.succeed(HttpClientResponse.fromWeb(outgoing, new Response("done")))
    );

    const handler = yield* serve(client);
    const context = Context.make(Tracer.Tracer, tracer);

    yield* call(
      handler,
      new Request("https://ratstack.sh/nonexistent"),
      context
    );
    expect(spans.some((span) => span.kind === "server")).toBe(true);
    spans.length = 0;

    yield* call(handler, request("GET", true), context);
    yield* call(handler, request("POST"), context);
    expect(
      spans.some((span) => span.kind === "server" || span.kind === "client")
    ).toBe(false);
    expect(
      spans.flatMap((span) => [...span.attributes.values()])
    ).not.toContain(rawToken);
  }).pipe(Effect.scoped)
);

it.effect("a captured unsubscribe event never contains the query token", () =>
  Effect.gen(function* privateEvent() {
    const client = HttpClient.make((outgoing) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(outgoing, new Response("unused"))
      )
    );

    const app = yield* HttpRouter.toHttpEffect(routeLayer(client));
    const events = yield* Layer.build(memoryEventsLayer("unsubscribe-test"));

    const response = yield* withEventCapture({
      identityMode: "daily",
      runInBackground: (effect) => effect,
    })(app).pipe(
      Effect.provideContext(events),
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(request("GET", true))
      )
    );

    const recorded = yield* EventSinkMemory.use((sink) => sink.events).pipe(
      Effect.provideContext(events)
    );

    expect(response.status).toBe(200);
    expect(recorded).toHaveLength(1);
    const [event] = recorded;

    const body = yield* Schema.decodeUnknownEffect(RequestBodySchema)(
      event?.body
    );

    expect(body.query).not.toHaveProperty("t");
    expect(JSON.stringify(event)).not.toContain(rawToken);
    expect(JSON.stringify(event)).not.toContain(decodeURIComponent(rawToken));
  }).pipe(Effect.scoped)
);
