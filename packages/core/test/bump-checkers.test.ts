// @effect-diagnostics nodeBuiltinImport:off -- This CLI seam test builds isolated repositories and invokes fake package-manager processes.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

interface Scenario {
  readonly effectVersion?: string;
  readonly ghExit?: number;
  readonly npmExit?: number;
  readonly parityExit?: number;
  readonly tsrsVersion?: string;
}

const fixture = (scenario: Scenario = {}) => {
  mkdirSync(path.join(repoRoot, ".rat"), { recursive: true });

  const directory = mkdtempSync(path.join(repoRoot, ".rat/checker-bump-test-"));
  const scripts = path.join(directory, "scripts");
  const bin = path.join(directory, "bin");
  mkdirSync(scripts);
  mkdirSync(bin);
  mkdirSync(path.join(directory, "packages/example"), { recursive: true });
  symlinkSync(
    path.join(repoRoot, "node_modules"),
    path.join(directory, "node_modules"),
    "dir"
  );
  copyFileSync(
    path.join(repoRoot, "scripts/bump-checkers.ts"),
    path.join(scripts, "bump-checkers.ts")
  );
  writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify({ devDependencies: { "@yielded/effect-tsrs": "0.2.0", tsrs: "0.18.0-ts7.1.0-dev.20260929" }, type: "module" }, null, 2)}\n`
  );
  writeFileSync(
    path.join(directory, "packages/example/package.json"),
    '{ "devDependencies": { "tsrs": "0.18.0-ts7.1.0-dev.20260929" } }\n'
  );
  writeFileSync(
    path.join(directory, "pnpm-workspace.yaml"),
    'minimumReleaseAgeExclude:\n  - "@yielded/effect-tsrs@0.2.0"\n  - "@yielded/effect-tsrs-linux-x64@0.2.0"\n'
  );
  writeFileSync(
    path.join(bin, "pnpm"),
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n");
if (args[0] === "view") {
  if (${scenario.npmExit ?? 0} !== 0) process.exit(${scenario.npmExit ?? 0});
  console.log(JSON.stringify(args[1] === "tsrs" ? ${JSON.stringify(scenario.tsrsVersion ?? "0.18.0-ts7.1.0-dev.20260929")} : ${JSON.stringify(scenario.effectVersion ?? "0.2.0")}));
} else if (args[0] === "exec") {
  console.log("effect-tsrs 0.2.0 (tsrs 8f135f106a63)");
} else if (args[0] === "typecheck:parity") {
  process.exit(${scenario.parityExit ?? 0});
}
`,
    { mode: 0o755 }
  );
  writeFileSync(
    path.join(bin, "gh"),
    `#!${process.execPath}
console.log('{"ahead_by":0,"behind_by":4}');
process.exit(${scenario.ghExit ?? 0});
`,
    { mode: 0o755 }
  );

  return {
    directory,
    run: () =>
      spawnSync(process.execPath, [path.join(scripts, "bump-checkers.ts")], {
        cwd: directory,
        encoding: "utf-8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      }),
  };
};

const withFixture = (
  scenario: Scenario,
  check: (setup: ReturnType<typeof fixture>) => void
) => {
  const setup = fixture(scenario);

  try {
    check(setup);
  } finally {
    rmSync(setup.directory, { force: true, recursive: true });
  }
};

const manifestFiles = [
  "package.json",
  "packages/example/package.json",
  "pnpm-workspace.yaml",
];

describe("checker bump CLI", () => {
  it("leaves current manifests byte-identical and skips install", () => {
    withFixture({}, ({ directory, run }) => {
      const before = manifestFiles.map((file) =>
        readFileSync(path.join(directory, file), "utf-8")
      );

      const result = run();

      const after = manifestFiles.map((file) =>
        readFileSync(path.join(directory, file), "utf-8")
      );

      expect(result.status, result.stderr).toBe(0);
      expect(after).toEqual(before);
      expect(
        readFileSync(path.join(directory, "calls.jsonl"), "utf-8")
      ).not.toContain('"install"');
      expect(result.stdout).toContain("alignment: aligned");
      expect(result.stdout).toContain("parity: pass");
    });
  });

  it("updates exact pins across workspaces and age exceptions before install and parity", () => {
    withFixture(
      { effectVersion: "0.3.0", tsrsVersion: "0.19.0" },
      ({ directory, run }) => {
        const result = run();
        expect(result.status, result.stderr).toBe(0);
        expect(
          readFileSync(path.join(directory, "package.json"), "utf-8")
        ).toContain('"tsrs": "0.19.0"');
        expect(
          readFileSync(
            path.join(directory, "packages/example/package.json"),
            "utf-8"
          )
        ).toContain('"tsrs": "0.19.0"');

        const workspace = readFileSync(
          path.join(directory, "pnpm-workspace.yaml"),
          "utf-8"
        );

        expect(workspace).toContain("@yielded/effect-tsrs@0.3.0");
        expect(workspace).toContain("@yielded/effect-tsrs-linux-x64@0.3.0");
        expect(workspace).toContain("tsrs@0.19.0");
        expect(workspace).not.toContain("@0.2.0");

        const calls = readFileSync(
          path.join(directory, "calls.jsonl"),
          "utf-8"
        );

        expect(calls).toContain('["install","--ignore-scripts"]');
        expect(calls.indexOf('"install"')).toBeLessThan(
          calls.indexOf('"typecheck:parity"')
        );
        expect(result.stdout).toContain("0.2.0 -> 0.3.0");
      }
    );
  });

  it("treats unavailable GitHub comparison as unknown and still checks parity", () => {
    withFixture({ ghExit: 1 }, ({ run }) => {
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("alignment: unknown");
      expect(result.stdout).toContain("parity: pass");
    });
  });

  it("names a failed npm invocation and its next command", () => {
    withFixture({ npmExit: 3 }, ({ run }) => {
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("CheckerBumpError");
      expect(result.stderr).toContain("read npm latest for tsrs failed");
      expect(result.stderr).toContain(
        "Next command: pnpm view tsrs dist-tags.latest --json"
      );
    });
  });

  it("fails the bump when checker parity fails", () => {
    withFixture({ parityExit: 1 }, ({ run }) => {
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("CheckerBumpError");
      expect(result.stderr).toContain("Next command: pnpm typecheck:parity");
      expect(result.stdout).toContain("parity: fail");
    });
  });
});
