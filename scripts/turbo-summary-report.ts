// @effect-diagnostics-next-line nodeBuiltinImport:off -- This report CLI reads local Turbo artifacts and never gates task execution.
import { readdirSync, readFileSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- This report CLI resolves the requested local summary directory.
import path from "node:path";
import { parseArgs } from "node:util";

import { Option, Schema } from "effect";

import { summarize, SurfaceSchema } from "./turbo-summary.ts";

const report = () => {
  const { values, positionals } = parseArgs({
    options: {
      surface: { type: "string", default: "local" },
      ref: { type: "string" },
    },
    allowPositionals: true,
  });

  const surface = Schema.decodeUnknownOption(SurfaceSchema)(values.surface);

  if (Option.isNone(surface) || positionals.length > 1) {
    process.stderr.write(
      "Turbo report arguments are invalid. The report needs a known surface and at most one summary directory. Fix: run `pnpm turbo:summary --surface local .turbo/runs`.\n"
    );

    return;
  }

  const directory = path.resolve(positionals[0] ?? ".turbo/runs");

  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .toSorted();

  if (files.length === 0) {
    process.stderr.write(
      "No Turbo summaries found. Cache telemetry is unavailable for this run. Fix: run Turbo with `--summarize` and retry `pnpm turbo:summary`.\n"
    );
  }

  for (const file of files) {
    try {
      const row = summarize(
        readFileSync(path.join(directory, file), "utf-8"),
        surface.value,
        values.ref
      );

      if (row === null) {
        process.stderr.write(
          `Turbo summary ${file} is invalid or unsupported. Its telemetry was skipped, not counted as a successful run. Fix: inspect the artifact and rerun with the pinned Turbo version.\n`
        );
      } else {
        process.stdout.write(`${JSON.stringify(row)}\n`);
      }
    } catch {
      process.stderr.write(
        `Turbo summary ${file} is unreadable. Other summaries will still be reported. Fix: check permissions on the run artifact.\n`
      );
    }
  }
};

try {
  report();
} catch {
  process.stderr.write(
    "Turbo telemetry could not be read. Reporting does not change the check result. Fix: run Turbo with `--summarize`, then retry `pnpm turbo:summary`.\n"
  );
}
