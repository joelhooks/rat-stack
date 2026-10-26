// @effect-diagnostics nodeBuiltinImport:off -- This compiler seam test reads workspace manifests and runs both installed compilers.
import { spawnSync } from "node:child_process";
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const normalize = (
  result: Pick<CompilerResult, "status" | "output">,
  workspace: string,
  omitEffect = false
) => {
  const diagnostics = [
    ...result.output.matchAll(
      /^(?<file>.+)\((?<line>\d+),(?<column>\d+)\): (?<severity>error|warning|suggestion|message) TS(?<code>\d+):/gmu
    ),
  ];

  if (
    result.status === null ||
    (result.status !== 0 &&
      !diagnostics.some(
        (match) =>
          match.groups?.severity === "error" ||
          match.groups?.severity === "warning"
      ))
  ) {
    throw new Error(`Compiler failed without diagnostics: ${result.output}`);
  }

  return {
    errors: [
      ...new Set(
        diagnostics.flatMap(({ groups }) => {
          if (groups === undefined) {
            throw new Error("Diagnostic match has no named groups");
          }

          if (
            groups.severity !== "error" ||
            (omitEffect &&
              Number(groups.code) >= 377_000 &&
              Number(groups.code) <= 377_999)
          ) {
            return [];
          }

          const file = path.relative(
            repoRoot,
            path.resolve(repoRoot, workspace, groups.file ?? "")
          );

          return [`${file}:${groups.line}:${groups.column}:TS${groups.code}`];
        })
      ),
    ].toSorted(),
    passed: omitEffect
      ? !diagnostics.some(
          ({ groups }) =>
            groups?.severity === "error" &&
            (Number(groups.code) < 377_000 || Number(groups.code) > 377_999)
        )
      : result.status === 0,
  };
};

const compile = (
  workspace: string,
  compiler: "tsc" | "effect-tsrs" | "tsrs"
): CompilerResult => {
  const started = performance.now();

  const result = spawnSync(
    path.join(repoRoot, "node_modules/.bin", compiler),
    compiler === "effect-tsrs"
      ? [
          "diagnostics",
          "--project",
          "tsconfig.json",
          "--strict",
          "--type-check",
        ]
      : ["--noEmit", "-p", "tsconfig.json", "--pretty", "false"],
    { cwd: path.join(repoRoot, workspace), encoding: "utf-8" }
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  if (compiler === "effect-tsrs" && result.status === 2) {
    throw new Error(
      `effect-tsrs invocation failed: ${result.stdout}${result.stderr}`
    );
  }

  return {
    milliseconds: performance.now() - started,
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
};

const diagnostic = (code: number, severity = "error", file = "fixture.ts") =>
  `${file}(1,1): ${severity} TS${code}: planted`;

const codeArbitrary = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 377_999, minimum: 1000 }))
);

const effectCode = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 377_999, minimum: 377_000 }))
);

describe("compiler result normalization", () => {
  it.prop(
    "normalizes paths and ignores messages and suggestions",
    { code: codeArbitrary },
    ({ code }) => {
      const relative = normalize(
        { output: diagnostic(code), status: 1 },
        "packages/core"
      );

      const absolute = normalize(
        {
          output: [
            diagnostic(
              code,
              "error",
              path.join(repoRoot, "packages/core/fixture.ts")
            ),
            diagnostic(code + 1, "message"),
            diagnostic(code + 2, "suggestion"),
          ].join("\n"),
          status: 1,
        },
        "packages/core"
      );

      expect(relative).toEqual(absolute);
      expect(relative.passed).toBe(false);
    }
  );

  it.prop(
    "a disagreement on any Effect code fails parity",
    { code: effectCode },
    ({ code }) => {
      const failed = normalize({ output: diagnostic(code), status: 1 }, ".");
      const passed = normalize({ output: "", status: 0 }, ".");

      const otherError = normalize(
        { output: diagnostic(code + 1), status: 1 },
        "."
      );

      expect(failed).not.toEqual(passed);
      expect(failed.errors).not.toEqual(otherError.errors);
      expect(failed.errors).toEqual([`fixture.ts:1:1:TS${code}`]);
    }
  );

  it.prop(
    "warning failures remain failures without entering the error comparison",
    { code: effectCode },
    ({ code }) => {
      expect(
        normalize({ output: diagnostic(code, "warning"), status: 1 }, ".")
      ).toEqual({ errors: [], passed: false });
    }
  );

  it.prop(
    "crashes and non-diagnostic failures never count as parity",
    { code: codeArbitrary },
    ({ code }) => {
      expect(() =>
        normalize({ output: diagnostic(code), status: null }, ".")
      ).toThrow();
      expect(() =>
        normalize({ output: `startup failure ${code}`, status: 1 }, ".")
      ).toThrow();
    }
  );
});

describe("workspace compiler parity", () => {
  it("rejects ordinary TypeScript errors even without Effect diagnostics", () => {
    mkdirSync(path.join(repoRoot, ".rat"), { recursive: true });
    const directory = mkdtempSync(path.join(repoRoot, ".rat/checker-parity-"));
    const workspace = path.relative(repoRoot, directory);
    writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        extends: "../../tsconfig.base.json",
        files: ["fixture.ts"],
      })
    );
    const source = path.join(directory, "fixture.ts");

    try {
      writeFileSync(source, "export const value: string = 1;\n");

      for (const compiler of ["effect-tsrs", "tsc", "tsrs"] as const) {
        const result = compile(workspace, compiler);
        expect(result.status, result.output).not.toBe(0);
        expect(normalize(result, workspace).errors).toEqual([
          `${workspace}/fixture.ts:1:14:TS2322`,
        ]);
      }

      writeFileSync(source, 'export const value: string = "valid";\n');

      for (const compiler of ["effect-tsrs", "tsc", "tsrs"] as const) {
        const result = compile(workspace, compiler);
        expect(normalize(result, workspace), result.output).toEqual({
          errors: [],
          passed: true,
        });
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("discovers workspaces", () => {
    expect(workspaces.length).toBeGreaterThan(0);
  });

  for (const workspace of workspaces) {
    it(`${workspace}: effect-tsrs and tsc agree on errors and exit verdict`, () => {
      const effectTsrs = compile(workspace, "effect-tsrs");
      const tsc = compile(workspace, "tsc");
      const tsrs = compile(workspace, "tsrs");
      process.stdout.write(
        `${workspace}: effect-tsrs=${effectTsrs.milliseconds.toFixed(0)}ms tsc=${tsc.milliseconds.toFixed(0)}ms tsrs=${tsrs.milliseconds.toFixed(0)}ms\n`
      );
      expect(
        normalize(effectTsrs, workspace),
        `${workspace}\neffect-tsrs (${effectTsrs.status}):\n${effectTsrs.output}\ntsc (${tsc.status}):\n${tsc.output}`
      ).toEqual(normalize(tsc, workspace));
      expect(
        normalize(tsrs, workspace, true),
        `${workspace}\ntsrs (${tsrs.status}):\n${tsrs.output}\ntsc (${tsc.status}):\n${tsc.output}`
      ).toEqual(normalize(tsc, workspace, true));
    });
  }
});
