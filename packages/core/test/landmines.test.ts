import { NodeServices } from "@effect/platform-node";
import { it as effectIt } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

import {
  baselineDrift,
  growthWithoutReason,
  readBaseline,
} from "../../../tools/oxlint/landmines/baseline.ts";
import type {
  Baseline,
  Budget,
} from "../../../tools/oxlint/landmines/baseline.ts";
import { readBudget } from "../../../tools/oxlint/landmines/finding.ts";
import { fenceMessage } from "./fixtures/fence-message.js";

RuleTester.describe = (name, run) => {
  describe(name, run);
};

RuleTester.it = (name, run) => {
  it(name, run);
};

await import(
  new URL("../../../tools/oxlint/landmines/rules.test.ts", import.meta.url).href
);

const originalPath = "packages/core/test/slow.test.ts";

const originalReason = "Waits for a spawned server to announce readiness.";

const original: Budget = ["test", ["boots the server"], "timeout", "10000"];

const raised: Budget = ["test", ["boots the server"], "timeout", "20000"];

const baseline: Baseline = {
  [originalPath]: [{ budget: original, reason: originalReason }],
};

describe("Landmines budget comparison", () => {
  it("banks a finding when its file disappears", () => {
    expect(baselineDrift(baseline, new Map())).toEqual([
      expect.stringContaining(`${originalPath} no longer reports`),
    ]);
    expect(baselineDrift({}, new Map())).toEqual([]);
  });

  it("does not let another directory inherit a same-suffix entry", () => {
    const otherPath = `examples/${originalPath}`;

    expect(baselineDrift(baseline, new Map([[otherPath, [original]]]))).toEqual(
      [
        expect.stringContaining(`${otherPath} reports an unrecorded budget`),
        expect.stringContaining(`${originalPath} no longer reports`),
      ]
    );
  });

  it("rejects swapping budgets between tests at the same count", () => {
    const replacement: Budget = [
      "test",
      ["reads unrelated output"],
      "timeout",
      "10000",
    ];

    const observed = new Map([[originalPath, [replacement]]]);

    expect(baselineDrift(baseline, observed)).toHaveLength(2);
    expect(
      growthWithoutReason(baseline, {
        [originalPath]: [{ budget: replacement, reason: originalReason }],
      })
    ).toHaveLength(1);
  });

  it("rejects raising a budget at the same count without a fresh reason", () => {
    const observed = new Map([[originalPath, [raised]]]);

    const copiedReason: Baseline = {
      [originalPath]: [{ budget: raised, reason: originalReason }],
    };

    const revised: Baseline = {
      [originalPath]: [
        {
          budget: raised,
          reason: "Waits for a restart and two independent readiness signals.",
        },
      ],
    };

    expect(baselineDrift(baseline, observed)).toHaveLength(2);
    expect(baselineDrift(copiedReason, observed)).toEqual([]);
    expect(growthWithoutReason(baseline, copiedReason)).toHaveLength(1);
    expect(growthWithoutReason(baseline, revised)).toEqual([]);
  });

  it("requires a one-line reason for each budget and exact multiplicity", () => {
    const observed = new Map([[originalPath, [original, original]]]);

    expect(baselineDrift(baseline, observed)).toHaveLength(1);
    expect(() =>
      readBaseline(
        JSON.stringify({
          [originalPath]: [{ budget: original, reason: "one\ntwo" }],
        })
      )
    ).toThrow();
    expect(() =>
      readBaseline(JSON.stringify({ [originalPath]: [{ budget: original }] }))
    ).toThrow();
  });
});

const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      diagnostics: Schema.Array(
        Schema.Struct({
          code: Schema.optionalKey(Schema.NullOr(Schema.String)),
          message: Schema.String,
          severity: Schema.String,
        })
      ),
    })
  )
);

const fixture = `import { defineConfig } from "vitest/config";
import { expect, it } from "vitest";
import { it as effectIt } from "@effect/vitest";
import { Effect } from "effect";
const firstBudget = 15_000;
const secondBudget = 30_000;
it("boots", { retry: 2, timeout: firstBudget }, () => {});
it("reads", { retry: 0, timeout: secondBudget }, () => {});
effectIt.live("clock", () => Effect.sleep("1 second"));
await expect.poll(() => requests.length).toBe(1);
export default defineConfig({ test: { hookTimeout: 20_000 } });
`;

effectIt.effect(
  "real Oxlint config enforces severity, diagnostics, and numeric budgets",
  () =>
    Effect.gen(function* lintRealConfig() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = path.resolve(import.meta.dirname, "../../..");

      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: "rat-landmines-",
      });

      const file = path.join(directory, "fence.test.ts");

      yield* fs.writeFileString(file, fixture);

      const handle = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [
            "node_modules/oxlint/bin/oxlint",
            "--config",
            "oxlint.config.ts",
            "--format",
            "json",
            file,
          ],
          { cwd: root }
        )
      );

      const output = yield* Stream.mkString(Stream.decodeText(handle.stdout));

      const { diagnostics } = yield* decodeReport(output);

      const landmines = diagnostics.filter(
        ({ code }) => code?.startsWith("landmines(") === true
      );

      expect(
        landmines.map(({ code, severity }) => `${code} ${severity}`).toSorted()
      ).toEqual([
        "landmines(no-fixed-sleep) warning",
        "landmines(no-flake-masking) warning",
        "landmines(no-flake-masking-timeout) warning",
        "landmines(no-flake-masking-timeout) warning",
        "landmines(no-flake-masking-timeout) warning",
        "landmines(no-unsignaled-poll) warning",
      ]);

      for (const { message } of landmines) {
        expect(fenceMessage(message), message).toBeDefined();
      }

      const timeouts = landmines.filter(
        ({ code }) => code === "landmines(no-flake-masking-timeout)"
      );

      expect(timeouts.map(({ message }) => readBudget(message))).toEqual(
        expect.arrayContaining([
          ["config", ["test"], "hookTimeout", "20000"],
          ["test", ["boots"], "timeout", "15000"],
          ["test", ["reads"], "timeout", "30000"],
        ])
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
