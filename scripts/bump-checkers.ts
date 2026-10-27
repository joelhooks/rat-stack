// @effect-diagnostics nodeBuiltinImport:off -- This Node CLI updates exact manifest pins and runs installed checkers.
import { spawnSync } from "node:child_process";
import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Schema } from "effect";

const root = path.resolve(import.meta.dirname, "..");

const checkers = ["tsrs", "@yielded/effect-tsrs"];

const Dependencies = Schema.optional(
  Schema.Record(Schema.String, Schema.String)
);

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Dependencies,
      devDependencies: Dependencies,
      optionalDependencies: Dependencies,
      peerDependencies: Dependencies,
    })
  )
);

const decodeVersion = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.String)
);

const decodeComparison = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      ahead_by: Schema.Int,
      behind_by: Schema.Int,
    })
  )
);

class CheckerBumpError extends Schema.TaggedError<
  CheckerBumpError,
  { readonly brand: unique symbol }
>()("CheckerBumpError", {
  command: Schema.String,
  detail: Schema.String,
  step: Schema.String,
}) {
  override get message() {
    return `${this.step} failed: ${this.detail}. Next command: ${this.command}`;
  }
}

interface Change {
  readonly name: string;
  readonly newVersion: string;
  readonly oldVersion: string;
}

const invoke = (command: string, args: readonly string[], step: string) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf-8" });

  if (result.error !== undefined || result.status !== 0) {
    throw new CheckerBumpError({
      command: [command, ...args].join(" "),
      detail:
        result.error?.message ??
        `${result.status}: ${result.stderr.length > 0 ? result.stderr : result.stdout}`,
      step,
    });
  }

  return result.stdout.trim();
};

const latestVersion = (name: string) => {
  const command = `pnpm view ${name} dist-tags.latest --json`;

  const output = invoke(
    "pnpm",
    ["view", name, "dist-tags.latest", "--json"],
    `read npm latest for ${name}`
  );

  try {
    const version = decodeVersion(output);

    if (!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/iu.test(version)) {
      throw new CheckerBumpError({
        command,
        detail: `not an exact version: ${version}`,
        step: "decode npm version",
      });
    }

    return version;
  } catch (error) {
    throw new CheckerBumpError({
      command,
      detail: String(error),
      step: "decode npm version",
    });
  }
};

const alignment = (plainVersion: string) => {
  try {
    const version = invoke(
      "pnpm",
      ["exec", "effect-tsrs", "--version"],
      "read bundled tsrs revision"
    );

    const revision = /\btsrs (?<sha>[\da-f]{12,40})\b/u.exec(version)?.groups
      ?.sha;

    if (revision === undefined) {
      return "unknown (effect-tsrs did not report its bundled tsrs revision)";
    }

    const tag = `v${plainVersion.split("-ts")[0]}`;

    const output = invoke(
      "gh",
      [
        "api",
        `repos/oxc-project/tsrs/compare/${tag}...${revision}`,
        "--jq",
        "{ahead_by,behind_by}",
      ],
      "compare tsrs revisions"
    );

    const comparison = decodeComparison(output);

    return comparison.ahead_by === 0
      ? `aligned (${revision} is contained in ${tag})`
      : `not aligned (${tag} is ${comparison.ahead_by} commits behind bundled ${revision}; behind_by=${comparison.behind_by})`;
  } catch (error) {
    return `unknown (${String(error)})`;
  }
};

const updateAgeExceptions = (changes: readonly Change[]) => {
  const file = path.join(root, "pnpm-workspace.yaml");
  const original = readFileSync(file, "utf-8");
  let updated = original;

  for (const { name, oldVersion, newVersion } of changes) {
    const names =
      name === "@yielded/effect-tsrs"
        ? [
            name,
            ...[
              "linux-x64",
              "linux-arm64",
              "darwin-x64",
              "darwin-arm64",
              "win32-x64",
            ].map((platform) => `${name}-${platform}`),
          ]
        : [name];

    for (const entry of names) {
      const oldEntry = `${entry}@${oldVersion}`;
      const newEntry = `${entry}@${newVersion}`;

      if (updated.includes(oldEntry)) {
        updated = updated.replaceAll(oldEntry, newEntry);
      } else if (!updated.includes(newEntry)) {
        if (!updated.includes("minimumReleaseAgeExclude:\n")) {
          updated += "\nminimumReleaseAgeExclude:\n";
        }

        updated = updated.replace(
          "minimumReleaseAgeExclude:\n",
          `minimumReleaseAgeExclude:\n  - "${newEntry}"\n`
        );
      }
    }
  }

  if (updated !== original) {
    writeFileSync(file, updated);
  }
};

const updateManifests = (changes: readonly Change[]) => {
  const files = globSync(
    ["package.json", "apps/*/package.json", "packages/*/package.json"],
    { cwd: root }
  ).toSorted();

  for (const file of files) {
    const filename = path.join(root, file);
    const original = readFileSync(filename, "utf-8");
    const manifest = decodeManifest(original);
    let updated = original;

    for (const section of Object.values(manifest)) {
      for (const { name, newVersion } of changes) {
        if (section?.[name] !== undefined) {
          const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
          const pattern = new RegExp(`("${escaped}"\\s*:\\s*)"[^"]+"`, "gu");
          updated = updated.replaceAll(
            pattern,
            `$1${JSON.stringify(newVersion)}`
          );
        }
      }
    }

    if (updated !== original) {
      writeFileSync(filename, updated);
    }
  }
};

const run = () => {
  const manifest = decodeManifest(
    readFileSync(path.join(root, "package.json"), "utf-8")
  );

  let changes = checkers.map((name): Change => {
    const oldVersion = manifest.devDependencies?.[name];

    if (oldVersion === undefined) {
      throw new CheckerBumpError({
        command: "pnpm bump:checkers",
        detail: `root devDependency ${name} is missing`,
        step: "read checker pin",
      });
    }

    return { name, newVersion: "unknown", oldVersion };
  });

  let verdict = "not run";
  let aligned = "unknown";

  try {
    changes = changes.map(({ name, oldVersion }) => ({
      name,
      newVersion: latestVersion(name),
      oldVersion,
    }));

    const changed = changes.filter(
      ({ oldVersion, newVersion }) => oldVersion !== newVersion
    );

    if (changed.length > 0) {
      updateManifests(changed);
      updateAgeExceptions(changed);
      invoke("pnpm", ["install", "--ignore-scripts"], "install checker pins");
    }

    const plain = changes.find(({ name }) => name === "tsrs");

    if (plain === undefined) {
      throw new CheckerBumpError({
        command: "pnpm bump:checkers",
        detail: "plain tsrs pin is missing",
        step: "compare checker versions",
      });
    }

    aligned = alignment(plain.newVersion);
    process.stdout.write(`tsrs alignment: ${aligned}\n`);

    const result = spawnSync("pnpm", ["typecheck:parity"], {
      cwd: root,
      stdio: "inherit",
    });

    if (result.error !== undefined || result.status !== 0) {
      verdict = "fail";
      throw new CheckerBumpError({
        command: "pnpm typecheck:parity",
        detail: result.error?.message ?? `exit ${result.status}`,
        step: "checker parity",
      });
    }

    verdict = "pass";
  } finally {
    process.stdout.write(
      `${changes.map(({ name, oldVersion, newVersion }) => `${name}: ${oldVersion} -> ${newVersion}`).join("; ")}; alignment: ${aligned}; parity: ${verdict}\n`
    );
  }
};

try {
  run();
} catch (error) {
  const failure = Schema.is(CheckerBumpError)(error)
    ? error
    : new CheckerBumpError({
        command: "pnpm bump:checkers",
        detail: String(error),
        step: "bump checkers",
      });

  process.stderr.write(`${failure._tag}: ${failure.message}\n`);
  process.exitCode = 1;
}
