import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";

import { Sandbox } from "../src/sandbox-service.js";
import { layerSubprocess } from "../src/sandbox-subprocess.js";
import { toExecuteCapability } from "../src/to-code-mode.js";
import {
  checkSandboxConformance,
  checkSandboxLimits,
  checkSandboxConcurrency,
} from "./fixtures/sandbox-conformance.js";
import {
  ProbeActivity,
  probe,
  probeMetrics,
} from "./fixtures/sandbox-probe.js";

const projection = toExecuteCapability([probe, probeMetrics]);

const limited = toExecuteCapability([probe, probeMetrics], {
  maxOutputBytes: 128,
  maxToolCalls: 2,
});

const TestLayer = Layer.merge(
  ProbeActivity.layer,
  layerSubprocess({ timeout: "5 seconds" }).pipe(
    Layer.provide(NodeServices.layer)
  )
);

describe("sandbox conformance", () => {
  it.live("runs independent calls with a peak concurrency of eight", () =>
    checkSandboxConcurrency((code) =>
      projection.capability.handler({ code }).pipe(Effect.orDie)
    ).pipe(Effect.provide(TestLayer))
  );

  it.effect(
    "adapter call budgets retain their admitted prefix under projection normalization",
    () =>
      Effect.gen(function* preservesAdapterAdmission() {
        const response = yield* projection.capability.handler({
          code: "await tools.probe({ value: 1 }); return await tools.probe({ value: 2 });",
        });

        expect(response).toMatchObject({
          diagnostic: { kind: "ToolCallLimitExceeded" },
          toolCalls: ["probe"],
        });
      }).pipe(
        Effect.provide(
          Layer.merge(
            ProbeActivity.layer,
            layerSubprocess({ maxToolCalls: 1, timeout: "5 seconds" }).pipe(
              Layer.provide(NodeServices.layer)
            )
          )
        )
      )
  );

  it.layer(TestLayer)("subprocess", (test) => {
    test.effect("returns the shared success, diagnostic and audit shapes", () =>
      checkSandboxConformance((code) =>
        projection.capability.handler({ code }).pipe(Effect.orDie)
      )
    );

    test.effect("enforces the shared call and output limits", () =>
      checkSandboxLimits((code) =>
        limited.capability.handler({ code }).pipe(Effect.orDie)
      )
    );

    test.effect("sanitizes host defects while retaining admitted calls", () =>
      Effect.gen(function* sanitizesHostFailure() {
        const sandbox = yield* Sandbox;

        const result = yield* sandbox.run("return await tools.fail({});", () =>
          Effect.die(new Error("private-host-secret"))
        );

        expect(result).toMatchObject({
          diagnostic: {
            kind: "ToolFailure",
            message: "Capability execution failed",
            tag: "HostDefect",
          },
          result: null,
          toolCalls: ["fail"],
        });
        expect(JSON.stringify(result)).not.toContain("private-host-secret");
      })
    );

    test.effect("host interruption remains interruption", () =>
      Effect.gen(function* preservesHostInterruption() {
        const sandbox = yield* Sandbox;

        const result = yield* Effect.exit(
          sandbox.run("return await tools.stop({});", () => Effect.interrupt)
        );

        expect(Exit.isFailure(result)).toBe(true);

        if (Exit.isFailure(result)) {
          expect(Cause.hasInterruptsOnly(result.cause)).toBe(true);
        }
      })
    );
  });
});
