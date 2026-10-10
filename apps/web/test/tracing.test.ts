import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Schema, Tracer } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  nativeTracerLayerFor,
  privateNativeTracerLayer,
  privateObservability,
  privateTracer,
  traceObservability,
  traceSettings,
} from "../../site/src/observability.js";
import { websiteTelemetryFor } from "../src/server/website-bindings.js";

it.effect.prop(
  "Effect span metadata drops request bodies, header values, emails, tokens and query strings",
  {
    body: Arbitrary.schema(Schema.String),
    email: Arbitrary.schema(Schema.String),
    header: Arbitrary.schema(Schema.String),
    query: Arbitrary.schema(Schema.String),
    token: Arbitrary.schema(Schema.String),
  },
  (input) =>
    Effect.gen(function* privateSpanMetadata() {
      const spans: Tracer.NativeSpan[] = [];

      const recording = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);

          return span;
        },
      });

      const attributes = {
        email: `${input.email}@example.com`,
        "http.request.body": input.body,
        "http.request.header.authorization": `Bearer ${input.header}`,
        token: input.token,
        "url.full": `https://example.com/?${new URLSearchParams({ secret: input.query }).toString()}`,
      };

      const link = {
        attributes,
        span: Tracer.externalSpan({ spanId: "parent", traceId: "trace" }),
      };

      yield* Effect.gen(function* annotatePrivateSpan() {
        yield* Effect.annotateCurrentSpan(attributes);
        const span = yield* Effect.currentSpan;
        span.event("request", 0n, attributes);
        span.addLinks([link]);
      }).pipe(
        Effect.withSpan("request", { attributes, links: [link] }),
        Effect.provideService(Tracer.Tracer, privateTracer(recording))
      );

      expect(spans).toHaveLength(1);

      for (const span of spans) {
        expect([...span.attributes]).toStrictEqual([]);
        expect(span.events).toStrictEqual([]);
        expect(span.links).toStrictEqual([]);
        expect(span.status._tag).toBe("Ended");
      }
    })
);

it.effect.prop(
  "native Cloudflare exports contain only a fixed completion marker",
  {
    failure: Arbitrary.schema(Schema.Boolean),
    key: Arbitrary.schema(Schema.String),
    secret: Arbitrary.schema(Schema.String),
  },
  ({ secret, key, failure }) =>
    Effect.gen(function* nativeExportPrivacy() {
      const exports: Map<string, string>[] = [];
      const closed: boolean[] = [];

      const runtime = {
        tracing: {
          startActiveSpan(name, runInSpan) {
            expect(name).toBe("request");
            const attributes = new Map<string, string>();
            exports.push(attributes);

            return runInSpan({
              end: () => {
                closed.push(true);
              },
              isTraced: true,
              setAttribute: (attributeKey, value) => {
                attributes.set(attributeKey, value);
              },
            });
          },
        },
      } satisfies Parameters<typeof nativeTracerLayerFor>[0];

      yield* Effect.annotateCurrentSpan({
        email: secret,
        "http.request.body": secret,
        "http.request.header.authorization": secret,
        token: secret,
        "url.full": `https://example.com/?secret=${secret}`,
        [key]: secret,
      }).pipe(
        Effect.andThen(failure ? Effect.fail(secret) : Effect.void),
        Effect.withSpan("request", { attributes: { secret } }),
        Effect.provide(nativeTracerLayerFor(runtime)),
        Effect.result
      );

      expect(exports).toHaveLength(1);
      expect(closed).toStrictEqual([true]);

      for (const attributes of exports) {
        expect([...attributes]).toStrictEqual([
          ["effect.exit", failure ? "failure" : "success"],
        ]);
      }
    })
);

it.effect("native tracer construction is fresh for each request scope", () =>
  Effect.gen(function* separateRequestTracers() {
    const first = yield* Tracer.Tracer.pipe(
      Effect.provide(privateNativeTracerLayer)
    );

    const second = yield* Tracer.Tracer.pipe(
      Effect.provide(privateNativeTracerLayer)
    );

    expect(first).not.toBe(second);
  })
);

it.effect.prop(
  "Website enables a fresh native tracer only for its explicit flag",
  { enabled: Arbitrary.schema(Schema.Boolean) },
  ({ enabled }) =>
    Effect.gen(function* websiteTraceSelection() {
      const defaultTracer = yield* Tracer.Tracer;

      const environment = {
        TRACES_ENABLED: enabled ? "true" : "false",
      } satisfies Parameters<typeof websiteTelemetryFor>[0];

      const first = yield* Tracer.Tracer.pipe(
        Effect.provide(websiteTelemetryFor(environment))
      );

      const second = yield* Tracer.Tracer.pipe(
        Effect.provide(websiteTelemetryFor(environment))
      );

      if (enabled) {
        expect(first).not.toBe(defaultTracer);
        expect(first).not.toBe(second);
      } else {
        expect(first).toBe(defaultTracer);
        expect(second).toBe(defaultTracer);
      }
    })
);

it.effect(
  "absent trace configuration leaves existing observability unchanged",
  () =>
    Effect.gen(function* defaultTraceConfiguration() {
      const settings = yield* traceSettings.pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({})
        )
      );

      expect(settings).toStrictEqual({
        enabled: false,
        headSamplingRate: 0.01,
      });
      expect(traceObservability(settings)).toBe(privateObservability);
    })
);

it.effect.prop(
  "enabled tracing uses the declared sampling rate without changing log privacy",
  {
    rate: Arbitrary.schema(
      Schema.Finite.check(Schema.isBetween({ maximum: 1, minimum: 0 }))
    ),
  },
  ({ rate }) =>
    Effect.gen(function* enabledTraceConfiguration() {
      const settings = yield* traceSettings.pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            TRACES_ENABLED: true,
            TRACES_HEAD_SAMPLING_RATE: rate,
          })
        )
      );

      const observability = traceObservability(settings);
      expect(observability.logs).toBe(privateObservability.logs);
      expect(observability.traces).toStrictEqual({
        enabled: true,
        headSamplingRate: rate === 0 ? 0 : rate,
      });
    })
);
