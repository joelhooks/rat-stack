// @effect-diagnostics nodeBuiltinImport:off -- These tests create temporary source fixtures and run the real oxlint binary against them.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const lintFixture = (source: string) => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "rat-stack-xstate-effect-")
  );

  const config = path.join(directory, "oxlint.json");
  const file = path.join(directory, "fixture.ts");

  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [
        {
          name: "xstate-effect",
          specifier: createRequire(import.meta.url).resolve(
            "@xstate/effect/oxlint"
          ),
        },
      ],
      rules: { "xstate-effect/no-inline-effect": "error" },
    })
  );
  writeFileSync(file, source);

  try {
    const result = spawnSync(
      path.join(repoRoot, "node_modules/.bin/oxlint"),
      ["-c", config, "--no-ignore", file],
      { cwd: repoRoot, encoding: "utf-8" }
    );

    return {
      output: `${result.stdout}${result.stderr}`,
      status: result.status ?? -1,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

describe("Effect-backed machine lint boundary", () => {
  it.each([
    "createEffectLogic",
    "createEffectStreamLogic",
    "createEffectEventStreamLogic",
  ])("rejects inline %s spawns", (constructor) => {
    const result = lintFixture(`enq.spawn(${constructor}(work));`);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Inline Effect logic passed to enq.spawn");
  });

  it("accepts declared actors and rejects discarded inline Effects", () => {
    expect(lintFixture("enq.spawn(args.actors.worker);").status).toBe(0);
    const result = lintFixture("enq(() => Effect.succeed(1));");

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(
      "An Effect returned from an inline action is discarded"
    );
  });
});
