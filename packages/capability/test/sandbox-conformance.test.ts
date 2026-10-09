import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";

import { Sandbox } from "../src/sandbox-service.js";
import { layerSubprocess } from "../src/sandbox-subprocess.js";
import { toExecuteCapability } from "../src/to-code-mode.js";
import { checkSandboxConformance } from "./fixtures/sandbox-conformance.js";
import { probe } from "./fixtures/sandbox-probe.js";

const projection = toExecuteCapability([probe]);

const TestLayer = layerSubprocess({ timeout: "5 seconds" }).pipe(
  Layer.provide(NodeServices.layer)
);

describe("sandbox conformance", () => {
  it.layer(TestLayer)("subprocess", (test) => {
    test.effect("returns the shared success, diagnostic and audit shapes", () =>
      checkSandboxConformance((code) =>
        projection.capability.handler({ code }).pipe(Effect.orDie)
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
