import { expect, it } from "@effect/vitest";
import { makeRequestEffect as untypedRequestEffect } from "alchemy/Cloudflare/Workers";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { buildEventTelemetry } from "alchemy/Telemetry";
import {
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
  Tracer,
} from "effect";
import type { Scope } from "effect";
import { HttpServerResponse } from "effect/http";

import { outerHttpPrivacyRegistration } from "../src/outer-http-privacy.js";

type ScopedHandledEffect = Effect.Effect<unknown, never, Scope.Scope>;

type NativeRequestBridge = (
  request: Request,
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse>
) => ScopedHandledEffect;

const requestBridge = Schema.decodeUnknownSync(
  Schema.declare<NativeRequestBridge>((input): input is NativeRequestBridge =>
    Predicate.isFunction(input)
  )
)(untypedRequestEffect);

const HandledResponseEffect = Schema.declare<ScopedHandledEffect>(
  (input): input is ScopedHandledEffect => Effect.isEffect(input)
);

const makeRequestEffect = (
  request: Request,
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse>
) =>
  Schema.decodeUnknownEffect(HandledResponseEffect)(
    requestBridge(request, handler)
  ).pipe(
    Effect.flatten,
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.instanceOf(Response)))
  );

it.effect(
  "the real Alchemy outer bridge exports normal spans but no sensitive request URL",
  () =>
    Effect.gen(function* exportedPrivacy() {
      const exported: Tracer.NativeSpan[] = [];

      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);

          span.end = (time, exit) => {
            end(time, exit);
            exported.push(span);
          };

          return span;
        },
      });

      const runtime = RuntimeContext.of({
        Type: "worker",
        env: {},
        get: <Value>() =>
          Effect.succeed(Option.getOrUndefined(Option.none<Value>())),
        id: "privacy-test",
        set: (id) => Effect.succeed(id),
        telemetry: Layer.succeed(Tracer.Tracer, tracer),
      });

      yield* Layer.build(outerHttpPrivacyRegistration).pipe(
        Effect.provideService(RuntimeContext, runtime)
      );

      const scope = yield* Effect.scope;

      const services = yield* buildEventTelemetry(
        Context.empty(),
        scope,
        runtime.telemetry,
        Layer.empty
      );

      const handler = Effect.succeed(HttpServerResponse.text("done"));
      const normal = "https://ratstack.sh/normal?utm_source=mail";

      yield* makeRequestEffect(
        new Request(normal, {
          headers: { host: "ratstack.sh", "x-forwarded-proto": "https" },
        }),
        handler
      ).pipe(Effect.provideContext(services));
      yield* Effect.yieldNow;
      expect(exported).toHaveLength(1);
      expect(exported[0]?.attributes.get("url.full")).toBe(normal);
      expect(exported[0]?.attributes.get("url.query")).toBe("utm_source=mail");
      exported.length = 0;

      for (const target of [
        "/operator/interest/applications",
        "/operator/interest/applications/erase",
        "/operator/interest/applications?submissionId=private-submission-reference",
        "/tokenmaxx/unsubscribe",
        "/tokenmaxx/unsubscribe?t=private-unsubscribe-value",
        "/normal?t=private-t-value",
        "/normal?token=private-token-value",
        "/normal?ticket=private-ticket-value",
        "/normal?TOKEN=private-uppercase-value",
        "/normal?%74icket=private-encoded-key-value",
      ]) {
        const response = yield* makeRequestEffect(
          new Request(`https://ratstack.sh${target}`),
          handler
        ).pipe(Effect.provideContext(services));

        yield* Effect.yieldNow;
        expect(response.status).toBe(200);
        expect(exported).toEqual([]);
      }
    }).pipe(Effect.scoped)
);
