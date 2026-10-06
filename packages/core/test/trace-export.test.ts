import { expect, it } from "@effect/vitest";
import { Effect, Layer, Predicate, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

const ExportedTrace = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      scopeSpans: Schema.Array(
        Schema.Struct({
          spans: Schema.Array(
            Schema.Struct({
              attributes: Schema.Array(
                Schema.Struct({ key: Schema.String, value: Schema.Unknown })
              ),
              name: Schema.String,
            })
          ),
        })
      ),
    })
  ),
});

it.effect(
  "scope shutdown exports named spans through the supplied transport",
  () =>
    Effect.gen(function* traceDelivery() {
      const deliveries = yield* Ref.make<
        readonly (typeof ExportedTrace.Type)[]
      >([]);

      const client = HttpClient.make((request) =>
        Effect.gen(function* receiveTelemetry() {
          if (!Predicate.isTagged(request.body, "Uint8Array")) {
            return yield* Effect.die("Expected serialized OTLP JSON bytes");
          }

          const text = new TextDecoder().decode(request.body.body);

          const trace = yield* Schema.decodeEffect(
            Schema.fromJsonString(ExportedTrace)
          )(text).pipe(Effect.orDie);

          yield* Ref.update(deliveries, (received) => [...received, trace]);

          return HttpClientResponse.fromWeb(request, new Response());
        })
      );

      const tracing = OtlpTracer.layer({
        resource: { serviceName: "wiki-fixture" },
        url: "https://collector.example.test/v1/traces",
      }).pipe(
        Layer.provide(OtlpSerialization.layerJson),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
      );

      yield* Effect.scoped(
        Effect.void.pipe(
          Effect.withSpan("fixture.read"),
          Effect.annotateSpans({ phase: "read" }),
          Effect.provide(tracing)
        )
      );

      const spans = (yield* Ref.get(deliveries)).flatMap((delivery) =>
        delivery.resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans)
        )
      );

      expect(spans.map((span) => span.name)).toContain("fixture.read");
      expect(
        spans.flatMap((span) =>
          span.attributes.map((attribute) => attribute.key)
        )
      ).toContain("phase");
    })
);
