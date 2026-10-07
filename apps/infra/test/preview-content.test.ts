import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import { collection } from "alchemy/Provider";
import { Stage } from "alchemy/Stage";
import { inMemoryState } from "alchemy/State";
import {
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
} from "effect/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/rpc";

import { contentLayer } from "../../mischief/src/capabilities/index.js";
import { rpcProjection } from "../../mischief/src/rpc-worker.js";
import { workerAssetsLayer } from "../../mischief/src/worker-content.js";
import { previewProgram } from "../alchemy.preview.js";

it.effect(
  "searches and reads through the compiled preview backend's assets",
  () =>
    Effect.gen(function* previewContentRoundTrip() {
      const stack = yield* Alchemy.Stack(
        "RatStackPreview",
        {
          providers: Layer.effect(Cloudflare.Providers, collection([])),
          state: inMemoryState(),
        },
        previewProgram
      ).pipe(
        Effect.provideService(Stage, "pr-17"),
        Effect.provideService(AlchemyContext, {
          adopt: false,
          dev: false,
          dotAlchemy: ".alchemy",
        }),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ PREVIEW_COMMIT: "a".repeat(40) })
        )
      );

      const props = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ assets: Schema.Struct({ directory: Schema.String }) })
      )(stack.resources.RpcBackend?.Props);

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const assets = HttpRouter.toWebHandler(
        HttpRouter.add("GET", "/*", (request) =>
          fs
            .readFile(
              path.join(
                props.assets.directory,
                new URL(request.url, "https://assets.invalid").pathname.slice(1)
              )
            )
            .pipe(Effect.map(HttpServerResponse.uint8Array))
        )
      );

      yield* Effect.addFinalizer(() => Effect.promise(assets.dispose));

      const server = HttpRouter.toWebHandler(
        RpcServer.layerHttp({
          group: rpcProjection.group,
          path: "/rpc",
          protocol: "http",
        }).pipe(
          Layer.provide(rpcProjection.layer),
          Layer.provide(contentLayer.pipe(Layer.provide(workerAssetsLayer))),
          Layer.provide(
            Layer.succeed(Cloudflare.WorkerEnvironment, {
              ASSETS: { fetch: assets.handler },
            })
          ),
          Layer.provide(RpcSerialization.layerJson)
        )
      );

      yield* Effect.addFinalizer(() => Effect.promise(server.dispose));

      const httpClient = HttpClient.make((request) =>
        HttpClientRequest.toWeb(request).pipe(
          Effect.orDie,
          Effect.flatMap((webRequest) =>
            Effect.promise(
              // @effect-diagnostics-next-line asyncFunction:off -- The in-memory HTTP handler exposes a Promise boundary.
              async () => await server.handler(webRequest)
            )
          ),
          Effect.map((response) =>
            HttpClientResponse.fromWeb(request, response)
          )
        )
      );

      const client = yield* RpcClient.make(rpcProjection.group).pipe(
        Effect.provide(
          RpcClient.layerProtocolHttp({ url: "https://preview.test/rpc" }).pipe(
            Layer.provide(RpcSerialization.layerJson),
            Layer.provide(Layer.succeed(HttpClient.HttpClient)(httpClient))
          )
        )
      );

      const result = yield* client.search({ limit: 1, query: "capability" });
      const match = result.matches.at(0);
      expect(match).toBeDefined();

      if (match === undefined) {
        return yield* Effect.die(
          new Error("Preview search must return content")
        );
      }

      const document = yield* client.read({ id: match.id });
      expect(document.id).toBe(match.id);
      expect(document.text.length).toBeGreaterThan(0);

      return document.id;
    }).pipe(Effect.provide(NodeServices.layer))
);
