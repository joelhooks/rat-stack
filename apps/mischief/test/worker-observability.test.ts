import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { expect } from "vitest";

import {
  privateObservability,
  silentObservability,
} from "../src/observability.js";

const sourceFiles = (
  directory: string
): Effect.Effect<
  readonly string[],
  PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* listSources() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(directory);
    const files: string[] = [];

    for (const entry of entries) {
      if (
        ["node_modules", "dist", "test"].includes(entry) ||
        entry.startsWith(".")
      ) {
        continue;
      }

      const file = path.join(directory, entry);
      const info = yield* fs.stat(file);

      if (info.type === "Directory") {
        files.push(...(yield* sourceFiles(file)));
      } else if (file.endsWith(".ts") && !file.endsWith(".generated.ts")) {
        files.push(file);
      }
    }

    return files;
  });

const workerDeclarations = (source: string) => [
  ...source.matchAll(
    /Cloudflare\.(?:Workers\.)?(?:Worker|RpcWorker)(?:<|\()|Cloudflare\.Website\.\w+(?:<|\()/gu
  ),
];

const policyAssignments = (source: string) => [
  ...source.matchAll(
    /\bobservability:\s*(?:privateObservability|silentObservability)\b/gu
  ),
];

it.effect(
  "every application Worker uses the shared request-metadata policy",
  () =>
    Effect.gen(function* checkWorkerSettings() {
      const fs = yield* FileSystem.FileSystem;

      const files = yield* sourceFiles(
        new URL("../../", import.meta.url).pathname
      );

      let workers = 0;

      for (const file of files) {
        const source = yield* fs.readFileString(file);

        const declarations = workerDeclarations(source);

        if (declarations.length > 0) {
          expect(policyAssignments(source).length, file).toBe(
            declarations.length
          );
          workers += declarations.length;
        }
      }

      expect(workers).toBeGreaterThan(0);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("keeps custom logs but disables invocation metadata and traces", () =>
  Effect.sync(() => {
    expect(privateObservability.enabled).toBe(true);
    expect(privateObservability.logs.enabled).toBe(true);
    expect(privateObservability.logs.invocationLogs).toBe(false);
    expect(privateObservability.traces.enabled).toBe(false);
    expect(silentObservability.enabled).toBe(false);
    expect(silentObservability.logs.enabled).toBe(false);
    expect(silentObservability.logs.invocationLogs).toBe(false);
    expect(silentObservability.traces.enabled).toBe(false);
  })
);
