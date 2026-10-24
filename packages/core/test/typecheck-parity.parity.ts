// @effect-diagnostics nodeBuiltinImport:off -- This compiler seam test reads workspace manifests and runs both installed compilers.
import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

interface CompilerResult {
  readonly status: number | null;
  readonly output: string;
  readonly milliseconds: number;
}

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    })
  )
);

const workspaces = globSync(
  ["apps/*/package.json", "packages/*/package.json", "package.json"],
  { cwd: repoRoot }
)
  .filter(
    (file) =>
      decodeManifest(readFileSync(path.join(repoRoot, file), "utf-8")).scripts
        ?.typecheck !== undefined
  )
  .map((file) => path.dirname(file))
  .toSorted();

const compilerPassed = (result: Pick<CompilerResult, "status" | "output">) => {
  if (result.status === null) {
    throw new Error(`Compiler did not exit normally: ${result.output}`);
  }

  const codes = [...result.output.matchAll(/\berror TS(?<code>\d+):/gu)].map(
    (match) => Number(match.groups?.code)
  );

  if (result.status !== 0 && codes.length === 0) {
    throw new Error(`Compiler failed without diagnostics: ${result.output}`);
  }

  return codes.every((code) => code >= 377_000 && code <= 377_999);
};

const compile = (
  workspace: string,
  compiler: "tsc" | "tsrs"
): CompilerResult => {
  const started = performance.now();

  const result = spawnSync(
    path.join(repoRoot, "node_modules/.bin", compiler),
    ["--noEmit", "-p", "tsconfig.json", "--pretty", "false"],
    { cwd: path.join(repoRoot, workspace), encoding: "utf-8" }
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  return {
    milliseconds: performance.now() - started,
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
};

const diagnostic = (code: number) =>
  `fixture.ts(1,1): error TS${code}: planted`;

const effectCode = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 377_999, minimum: 377_000 }))
);

const typeCode = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 9999, minimum: 1000 }))
);

describe("compiler result normalization", () => {
  it.prop(
    "only Effect diagnostics can turn a failing exit into a parity pass",
    {
      code: typeCode,
      effectCodes: Arbitrary.array(effectCode, { minLength: 1 }),
    },
    ({ effectCodes, code }) => {
      const output = effectCodes.map(diagnostic).join("\n");
      expect(compilerPassed({ output, status: 1 })).toBe(true);
      expect(
        compilerPassed({ output: `${output}\n${diagnostic(code)}`, status: 1 })
      ).toBe(false);
      expect(
        compilerPassed({ output: `${diagnostic(code)}\n${output}`, status: 2 })
      ).toBe(false);
    }
  );

  it.prop(
    "crashes and non-diagnostic failures never count as parity",
    { code: typeCode },
    ({ code }) => {
      expect(() =>
        compilerPassed({ output: diagnostic(code), status: null })
      ).toThrow();
      expect(() =>
        compilerPassed({ output: `startup failure ${code}`, status: 1 })
      ).toThrow();
    }
  );
});

describe("workspace compiler parity", () => {
  it("discovers workspaces", () => {
    expect(workspaces.length).toBeGreaterThan(0);
  });

  for (const workspace of workspaces) {
    it(`${workspace}: tsrs and tsc agree outside Effect diagnostics`, () => {
      const tsrs = compile(workspace, "tsrs");
      const tsc = compile(workspace, "tsc");
      process.stdout.write(
        `${workspace}: tsrs=${tsrs.milliseconds.toFixed(0)}ms tsc=${tsc.milliseconds.toFixed(0)}ms\n`
      );
      expect(
        compilerPassed(tsrs),
        `${workspace}\ntsrs (${tsrs.status}):\n${tsrs.output}\ntsc (${tsc.status}):\n${tsc.output}`
      ).toBe(compilerPassed(tsc));
    });
  }
});
