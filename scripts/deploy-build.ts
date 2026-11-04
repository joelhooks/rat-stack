// @effect-diagnostics nodeBuiltinImport:off -- This Node CLI fingerprints build outputs and runs the workspace build before a deploy command.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  globSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { Option, Schema } from "effect";

import {
  BuildStampSchema,
  decideBuild,
  stampAfterBuild,
} from "../packages/deploy/src/build-stamp.ts";
import type {
  BuildStamp,
  BuildState,
} from "../packages/deploy/src/build-stamp.ts";

const root = path.resolve(import.meta.dirname, "..");

const stampPath = path.join(root, ".rat/deploy/build-stamp.json");

const outputPatterns = [
  "apps/*/dist/**",
  "packages/*/dist/**",
  "apps/site/src/*.generated.ts",
];

const decodeStamp = Schema.decodeUnknownOption(
  Schema.fromJsonString(BuildStampSchema)
);

class DeployBuildError extends Schema.TaggedError<
  DeployBuildError,
  { readonly brand: unique symbol }
>()("DeployBuildError", {
  command: Schema.String,
  detail: Schema.String,
}) {
  override get message() {
    return `Deploy build failed: ${this.detail}. The deploy command needs a complete build of this tree. Fix: run \`${this.command}\` and fix the first error it prints.`;
  }
}

const git = (args: readonly string[]) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf-8" });

  if (result.error !== undefined || result.status !== 0) {
    throw new DeployBuildError({
      command: `git ${args.join(" ")}`,
      detail: result.error?.message ?? result.stderr.trim(),
    });
  }

  return result.stdout;
};

const outputDigest = () => {
  const rows = outputPatterns
    .flatMap((pattern) => globSync(pattern, { cwd: root }))
    .flatMap((file) => {
      const stat = statSync(path.join(root, file));

      return stat.isFile() ? [`${file}\0${stat.size}\0${stat.mtimeMs}`] : [];
    })
    .toSorted();

  return createHash("sha256").update(rows.join("\n")).digest("hex");
};

const buildState = (): BuildState => ({
  changed: git(["status", "--porcelain=v1", "--untracked-files=normal"])
    .split("\n")
    .filter((line) => line.trim().length > 0),
  head: git(["rev-parse", "HEAD"]).trim(),
  outputs: outputDigest(),
  tree: git(["rev-parse", "HEAD^{tree}"]).trim(),
});

const readStamp = (): BuildStamp | undefined => {
  try {
    return Option.getOrUndefined(decodeStamp(readFileSync(stampPath, "utf-8")));
  } catch {
    return undefined;
  }
};

const writeStamp = (stamp: BuildStamp) => {
  mkdirSync(path.dirname(stampPath), { recursive: true });
  const temporary = `${stampPath}.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(stamp)}\n`, { mode: 0o600 });
  renameSync(temporary, stampPath);
};

const buildCommand = ["turbo", "run", "build", "--concurrency=1"];

try {
  const before = buildState();
  const decision = decideBuild(before, readStamp());

  if (decision.kind === "reuse") {
    process.stdout.write(
      `deploy-build: reusing the build of tree ${decision.stamp.tree} (head ${decision.stamp.head}); outputs are unchanged since it ran.\n`
    );
  } else {
    process.stdout.write(`deploy-build: building (${decision.reason}).\n`);

    const build = spawnSync("pnpm", buildCommand, {
      cwd: root,
      stdio: "inherit",
    });

    if (build.error !== undefined || build.status !== 0) {
      throw new DeployBuildError({
        command: `pnpm ${buildCommand.join(" ")}`,
        detail: build.error?.message ?? `exit ${build.status}`,
      });
    }

    const stamp = stampAfterBuild(before, buildState());

    if (stamp !== undefined) {
      writeStamp(stamp);
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
