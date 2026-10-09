import { AsyncLocalStorage } from "node:async_hooks";

import * as Cloudflare from "alchemy/Cloudflare";
import type { WorkerObservability } from "alchemy/Cloudflare/Workers";
import { CurrentRuntimeContext } from "alchemy/RuntimeContext";
import {
  Config,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Schema,
  Tracer,
} from "effect";

export const privateObservability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: false },
  traces: { enabled: false },
} satisfies WorkerObservability;

export const silentObservability = {
  ...privateObservability,
  enabled: false,
  logs: { enabled: false, invocationLogs: false },
} satisfies WorkerObservability;

export const traceSettings = Config.all({
  enabled: Config.Boolean("TRACES_ENABLED").pipe(Config.withDefault(false)),
  headSamplingRate: Config.schema(
    Schema.Finite.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
    "TRACES_HEAD_SAMPLING_RATE"
  ).pipe(Config.withDefault(0.01)),
});

export type TraceSettings = Config.Success<typeof traceSettings>;

export const traceObservability = (
  settings: TraceSettings
): WorkerObservability =>
  settings.enabled
    ? {
        ...privateObservability,
        traces: { enabled: true, headSamplingRate: settings.headSamplingRate },
      }
    : privateObservability;

// oxlint-disable-next-line eslint/no-empty-function -- This privacy boundary deliberately discards all untrusted span metadata.
const discardSpanMetadata = () => {};

export const privateTracer = (tracer: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    context: tracer.context,
    span(options) {
      const span = tracer.span({ ...options, links: [] });
      span.attribute = discardSpanMetadata;
      span.event = discardSpanMetadata;
      span.addLinks = discardSpanMetadata;

      return span;
    },
  });

const privateTracerLayer = Layer.effect(
  Tracer.Tracer,
  Effect.gen(function* makePrivateTracer() {
    return privateTracer(yield* Tracer.Tracer);
  })
);

class NativeTracingUnavailable extends Schema.TaggedError<NativeTracingUnavailable>()(
  "NativeTracingUnavailable",
  { cause: Schema.Unknown }
) {}

interface NativeSpan {
  readonly isTraced: boolean;
  readonly setAttribute: (name: string, value: string) => void;
  readonly end: () => void;
}

interface NativeTracing {
  readonly startActiveSpan: <A>(
    name: string,
    callback: (span: NativeSpan) => A
  ) => A;
}

const NativeRuntime = Schema.Struct({
  tracing: Schema.optionalKey(
    Schema.Struct({
      startActiveSpan: Schema.declare<NativeTracing["startActiveSpan"]>(
        (input): input is NativeTracing["startActiveSpan"] =>
          Predicate.isFunction(input)
      ),
    })
  ),
});

export const nativeTracerLayerFor = (runtime: typeof NativeRuntime.Type) =>
  Layer.effect(
    Tracer.Tracer,
    Effect.sync(() => {
      const { tracing } = runtime;
      const requestContext = AsyncLocalStorage.snapshot();
      const contexts = new WeakMap<Tracer.Span, typeof requestContext>();

      const contextFor = (span: Tracer.AnySpan | undefined) =>
        span?._tag === "Span"
          ? (contexts.get(span) ?? requestContext)
          : requestContext;

      return privateTracer(
        Tracer.make({
          context(primitive, fiber) {
            return contextFor(fiber.cache.span)(() =>
              primitive["~effect/Effect/evaluate"](fiber)
            );
          },
          span(options) {
            const parentContext = options.root
              ? requestContext
              : contextFor(Option.getOrUndefined(options.parent));

            if (!options.sampled || tracing?.startActiveSpan === undefined) {
              return new Tracer.NativeSpan({ ...options, sampled: false });
            }

            return parentContext(() =>
              tracing.startActiveSpan(options.name, (native) => {
                const span = new Tracer.NativeSpan({
                  ...options,
                  sampled: native.isTraced,
                });

                contexts.set(span, AsyncLocalStorage.snapshot());

                const end = span.end.bind(span);

                span.end = (time, exit) => {
                  end(time, exit);
                  native.setAttribute(
                    "effect.exit",
                    Exit.isSuccess(exit) ? "success" : "failure"
                  );
                  native.end();
                };

                return span;
              })
            );
          },
        })
      );
    })
  );

export const privateNativeTracerLayer = Layer.unwrap(
  Effect.tryPromise({
    catch: (cause) => new NativeTracingUnavailable({ cause }),
    // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare owns this per-request Promise import boundary.
    try: async () => await import("cloudflare:workers"),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(NativeRuntime)),
    Effect.option,
    Effect.map((runtime) =>
      nativeTracerLayerFor(Option.getOrElse(runtime, () => ({})))
    )
  )
);

export const privateTelemetry = Layer.unwrap(
  traceSettings.pipe(
    Effect.orDie,
    Effect.map((settings) =>
      settings.enabled
        ? Layer.effectDiscard(
            Effect.gen(function* registerPrivateTelemetry() {
              yield* Layer.build(
                Cloudflare.Telemetry({
                  enabled: true,
                  headSamplingRate: settings.headSamplingRate,
                })
              );
              const runtime = yield* CurrentRuntimeContext;

              if (runtime?.telemetry !== undefined) {
                // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy erases requirements in its per-event exporter registry; WorkerBridge supplies them.
                runtime.telemetry = privateTracerLayer.pipe(
                  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The SDK-erased registered exporter is rebuilt by WorkerBridge inside each event scope.
                  Layer.provide(runtime.telemetry)
                );
              }
            })
          )
        : Layer.empty
    )
  )
);
