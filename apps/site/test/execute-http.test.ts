import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { layerSubprocess } from "@rat-stack/capability";
import { ExecuteResult } from "@rat-stack/capability/code-mode";
import { Effect, FileSystem, Layer, Schema } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";

import { mischiefRoutes } from "../src/app.js";
import { FileAssets } from "./generated-content.js";

const sandbox = Layer.merge(
  FileAssets,
  layerSubprocess({ timeout: "5 seconds" }).pipe(
    Layer.provide(NodeServices.layer)
  )
);

it.effect("execute HTTP recovers after a synchronous infinite loop", () =>
  Effect.gen(function* executeHttpPrograms() {
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(mischiefRoutes().pipe(Layer.provide(sandbox)), {
          disableLogger: true,
        })
      ),
      ({ dispose }) => Effect.promise(dispose)
    );

    const execute = (code: string) =>
      Effect.promise(
        handler.bind(
          undefined,
          new Request("http://mischief.test/api/execute", {
            body: JSON.stringify({ code }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
          undefined
        )
      ).pipe(
        Effect.flatMap((response) => {
          expect(response.status).toBe(200);

          return Effect.promise(response.json.bind(response));
        }),
        Effect.flatMap(Schema.decodeUnknownEffect(ExecuteResult))
      );

    const timeout = yield* execute("while(true){}");
    expect(timeout).toMatchObject({
      diagnostic: { kind: "TimeoutExceeded" },
      result: null,
    });

    const arithmetic = yield* execute("return 1+1");
    expect(arithmetic).toMatchObject({ diagnostic: null, result: 2 });

    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory("dist/startup", { recursive: true });
    yield* fs.writeFileString(
      "dist/startup/execute-http-proof.json",
      JSON.stringify({
        adapter: "node-subprocess",
        arithmetic: { code: "return 1+1", response: arithmetic },
        path: "/api/execute",
        timeout: { code: "while(true){}", response: timeout },
      })
    );
  }).pipe(Effect.provide(NodeServices.layer))
);
