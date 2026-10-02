import { CurrentRuntimeContext } from "alchemy/RuntimeContext";
import { Effect, Layer } from "effect";

import { privateHttpTracingLayer } from "./http-privacy.js";

export const outerHttpPrivacyRegistration = Layer.effectDiscard(
  Effect.gen(function* registerOuterHttpPrivacy() {
    const runtime = yield* CurrentRuntimeContext;

    if (runtime !== undefined) {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy intentionally erases exporter layer requirements in its per-event registry.
      runtime.telemetry =
        runtime.telemetry === undefined
          ? privateHttpTracingLayer
          : Layer.mergeAll(
              // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The existing registry layer retains its SDK-erased requirements until WorkerBridge provides them.
              runtime.telemetry,
              privateHttpTracingLayer
            );
    }
  })
);
