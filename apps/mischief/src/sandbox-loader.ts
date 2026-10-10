import { resolveLimits, Sandbox } from "@rat-stack/capability/sandbox-port";
import { Duration, Effect, Layer } from "effect";

import type {
  WorkerLoaderBinding,
  WorkerLoaderSandboxOptions,
} from "./sandbox-worker-loader.js";

export const sandboxLimits: WorkerLoaderSandboxOptions = {
  compatibilityDate: "2026-05-28",
  cpuMs: 100,
  subRequests: 5,
  timeout: "10 seconds",
};

export const layerWorkerLoader = (
  loader: WorkerLoaderBinding,
  options: WorkerLoaderSandboxOptions = {}
): Layer.Layer<Sandbox> => {
  const timeout = Duration.fromInputUnsafe(options.timeout ?? "10 seconds");

  const configured = resolveLimits(options);

  const runtimeOptions: WorkerLoaderSandboxOptions = {
    ...configured,
    compatibilityDate: options.compatibilityDate ?? "2026-05-28",
    get cpuMs() {
      return options.cpuMs;
    },
    get subRequests() {
      return options.subRequests;
    },
    timeout,
  };

  const run: Sandbox["Service"]["run"] = (code, invoke, names, limits) =>
    Effect.suspend(() => {
      const loaded = import("./sandbox-worker-loader.js");

      return Effect.promise(loaded.finally.bind(loaded, undefined)).pipe(
        Effect.flatMap((runtime) =>
          Sandbox.use((sandbox) =>
            sandbox.run(code, invoke, names, limits)
          ).pipe(
            Effect.provide(runtime.layerWorkerLoader(loader, runtimeOptions))
          )
        )
      );
    });

  return Layer.succeed(Sandbox, { run });
};
