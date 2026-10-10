import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { rpcContentDirectory } from "../../site/src/rpc-worker.js";
import type { BundleOutput } from "../node_modules/alchemy/lib/Bundle/Bundle.js";
import { WorkerBundle } from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";

const nativeProbe = String.raw`
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { searchContract, readContract } from "@rat-stack/core/contracts";

export default {
  async test(_controller, env) {
    const httpClient = HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.orDie,
        Effect.flatMap((webRequest) => Effect.promise(async () => {
          const response = await env.WEBSITE.fetch(webRequest);
          if (response.headers.get("x-preview-commit") !== env.COMMIT ||
              response.headers.get("x-robots-tag") !== "noindex") {
            throw new Error("The selected Website artifact lost preview RPC headers");
          }
          return response;
        })),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response))
      )
    );
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const client = yield* RpcClient.make(toRpcGroup([searchContract, readContract]).group).pipe(
        Effect.provide(RpcClient.layerProtocolHttp({url: "https://pr-40.ratstack.sh/rpc"}).pipe(
          Layer.provide(RpcSerialization.layerJson),
          Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
        ))
      );
      const result = yield* client.search({limit: 1, query: "capability"});
      const match = result.matches.at(0);
      if (match === undefined) throw new Error("Native RpcBackend search returned no content");
      const document = yield* client.read({id: match.id});
      if (document.id !== match.id || document.text.length === 0) {
        throw new Error("Native RpcBackend read did not return the searched document");
      }
      console.log("READER_NATIVE_RPC_OK", JSON.stringify({id: document.id, characters: document.text.length}));
    })));
  }
};
`;

const worker = (source: string, bindings: string) =>
  `worker = (modules = [${source}], compatibilityDate = "2026-05-28", compatibilityFlags = ["nodejs_compat"], bindings = [${bindings}])`;

export const proveWebsiteWorkerd = Effect.fn("proveWebsiteWorkerd")(
  function* proveWebsiteWorkerd(website: BundleOutput, commit: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = new URL("../../../", import.meta.url).pathname;

    const directory = yield* fs.makeTempDirectoryScoped({
      directory: path.join(root, "apps/web/dist"),
      prefix: "native-reader-",
    });

    const bundler = yield* WorkerBundle;
    const compatibility = { date: "2026-05-28", flags: ["nodejs_compat"] };
    const stack = { name: "RatStackPreview", stage: "pr-40" };

    const backend = yield* bundler.build({
      compatibility,
      entry: { exports: {}, kind: "effect" },
      extraOptions: undefined,
      id: "RpcBackend",
      main: new URL("../../site/src/rpc-worker.ts", import.meta.url).href,
      stack,
    });

    const probeMain = path.join(directory, "probe.ts");
    yield* fs.writeFileString(probeMain, nativeProbe);

    const probe = yield* bundler.build({
      compatibility,
      entry: { kind: "external" },
      extraOptions: undefined,
      id: "NativeReaderProbe",
      main: probeMain,
      stack,
    });

    const modules = Effect.fn("nativeReaderModules")(function* modules(
      name: string,
      bundle: BundleOutput
    ) {
      return yield* Effect.forEach((file: BundleOutput["files"][number]) =>
        Effect.gen(function* writeModule() {
          const moduleType = /\.(?:m?js)$/u.test(file.path)
            ? "esModule"
            : "text";

          if (!/\.(?:m?js|map|json|css)$/u.test(file.path)) {
            return yield* Effect.die(
              new Error(`Unexpected native module: ${file.path}`)
            );
          }

          const destination = path.join(directory, name, file.path);
          yield* fs.makeDirectory(path.dirname(destination), {
            recursive: true,
          });
          yield* fs.writeFile(
            destination,
            Schema.is(Schema.String)(file.content)
              ? new TextEncoder().encode(file.content)
              : file.content
          );

          return `(name = ${JSON.stringify(file.path)}, ${moduleType} = embed ${JSON.stringify(path.relative(directory, destination))})`;
        })
      )(bundle.files).pipe(Effect.map((files) => files.join(",\n")));
    });

    const websiteModules = yield* modules("website", website);
    const backendModules = yield* modules("backend", backend);
    const probeModules = yield* modules("probe", probe);

    const config = `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "website", ${worker(websiteModules, `(name = "BACKEND", service = "backend"), (name = "PREVIEW_COMMIT", text = ${JSON.stringify(commit)})`)}),
    (name = "backend", ${worker(backendModules, '(name = "ASSETS", service = "content")')}),
    (name = "probe", ${worker(probeModules, `(name = "WEBSITE", service = "website"), (name = "COMMIT", text = ${JSON.stringify(commit)})`)}),
    (name = "content", disk = (path = ${JSON.stringify(rpcContentDirectory())}))
  ]
);
`;

    const configPath = path.join(directory, "test.capnp");
    yield* fs.writeFileString(configPath, config);

    const packages = (yield* fs.readDirectory(
      path.join(root, "node_modules/.pnpm")
    )).filter((name) => name.startsWith("workerd@"));

    if (packages.length !== 1 || packages[0] === undefined) {
      return yield* Effect.die(
        new Error("Native reader proof requires one installed workerd version")
      );
    }

    const executable = path.join(
      root,
      "node_modules/.pnpm",
      packages[0],
      "node_modules/workerd/bin/workerd"
    );

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const child = yield* spawner.spawn(
      ChildProcess.make(executable, ["test", configPath, "probe"])
    );

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        child.stdout.pipe(Stream.decodeText(), Stream.mkString),
        child.stderr.pipe(Stream.decodeText(), Stream.mkString),
        child.exitCode,
      ],
      { concurrency: "unbounded" }
    );

    if (
      exitCode !== 0 ||
      !`${stdout}${stderr}`.includes("READER_NATIVE_RPC_OK")
    ) {
      return yield* Effect.die(
        new Error(
          `Native reader proof failed (${exitCode}): ${stdout}\n${stderr}`
        )
      );
    }

    return { exitCode, stderr, stdout };
  }
);
