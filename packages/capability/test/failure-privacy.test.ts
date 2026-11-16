import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Logger, Path, Schema } from "effect";
import { McpServer } from "effect/ai";
import { CliOutput, Command } from "effect/cli";
import { Etag, HttpPlatform, HttpRouter } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { TestConsole } from "effect/testing";

import {
  defineContract,
  implement,
  toCommand,
  toHttpApi,
  toRpc,
  toToolkit,
} from "../src/index.js";
import { invokerFor } from "../src/to-code-mode.js";
import { wireFailureSchema } from "../src/wire-failure.js";
import { makeMcpClient, serverLayer } from "./mcp-harness.js";
import { RequiredCauseFailure } from "./required-cause-failure.js";

const secret = "planted-cause-secret-8f173";

class PrivateFailure extends Schema.TaggedError<
  PrivateFailure,
  { readonly brand: unique symbol }
>()("PrivateFailure", {
  cause: Schema.optionalKey(Schema.Defect()),
  detail: Schema.String,
}) {}

const RpcRequest = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Struct({ required: Schema.Boolean }),
  tag: Schema.String,
});

const contract = defineContract("privateFailure", {
  description: "Fail with private diagnostics",
  failure: Schema.Union([PrivateFailure, RequiredCauseFailure]),
  input: Schema.Struct({ required: Schema.Boolean }),
  output: Schema.Never,
});

const capability = implement(contract, ({ required }) =>
  Effect.fail(
    required
      ? new RequiredCauseFailure({
          cause: new Error(secret),
          detail: "retained-detail",
        })
      : new PrivateFailure({
          cause: new Error(secret),
          detail: "retained-detail",
        })
  )
);

const services = Layer.mergeAll(
  Path.layer,
  Etag.layerWeak,
  HttpPlatform.layer
).pipe(Layer.provideMerge(FileSystem.layerNoop({})));

const surfaces = [
  {
    name: "HTTP",
    response: (required: boolean) =>
      Effect.gen(function* httpResponse() {
        const projection = toHttpApi("PrivateFailureApi", [capability]);

        const client = yield* HttpApiTest.groups(projection.api, [
          "capabilities",
        ]).pipe(
          Effect.provide(projection.layer.pipe(Layer.provideMerge(services)))
        );

        const response = yield* client.capabilities.privateFailure({
          payload: { required },
          responseMode: "response-only",
        });

        expect(response.status).toBe(422);

        return yield* response.text;
      }),
  },
  {
    name: "RPC",
    response: (required: boolean) =>
      Effect.gen(function* rpcResponse() {
        const projection = toRpc([capability]);

        const server = RpcServer.layerHttp({
          group: projection.group,
          path: "/rpc",
          protocol: "http",
        }).pipe(
          Layer.provideMerge(projection.layer),
          Layer.provide(RpcSerialization.layerJson)
        );

        const { dispose, handler } = HttpRouter.toWebHandler(server, {
          disableLogger: true,
        });

        yield* Effect.addFinalizer(() => Effect.promise(dispose));

        const response = yield* Effect.promise(() =>
          handler(
            new Request("http://localhost/rpc", {
              body: JSON.stringify(
                RpcRequest.make({
                  headers: [],
                  id: "privacy",
                  payload: { required },
                  tag: "privateFailure",
                })
              ),
              headers: { "content-type": "application/json" },
              method: "POST",
            })
          )
        );

        return yield* Effect.promise(() => response.text());
      }),
  },
  {
    name: "MCP toolkit",
    response: (required: boolean) =>
      Effect.gen(function* mcpResponse() {
        const projection = toToolkit([capability]);

        const server = McpServer.toolkit(projection.toolkit).pipe(
          Layer.provideMerge(projection.layer),
          Layer.provide(serverLayer)
        );

        const client = yield* makeMcpClient(server);

        const response = yield* client["tools/call"]({
          arguments: { required },
          name: "privateFailure",
        });

        expect(response.isError).toBe(true);

        return JSON.stringify(response);
      }),
  },
  {
    name: "code mode",
    response: (required: boolean) =>
      Effect.gen(function* codeModeResponse() {
        const invoke = yield* invokerFor([capability]);
        const response = yield* invoke("privateFailure", { required });
        expect(response.ok).toBe(false);

        return JSON.stringify(response);
      }),
  },
];

describe("contract failure privacy", () => {
  for (const surface of surfaces) {
    for (const required of [false, true]) {
      it.effect(
        `${surface.name} strips ${required ? "required" : "optional"} causes without losing public fields`,
        () =>
          Effect.gen(function* publicResponse() {
            const response = yield* surface.response(required);
            expect(response).not.toContain(secret);
            expect(response).toContain(
              required ? "RequiredCauseFailure" : "PrivateFailure"
            );
            expect(response).toContain("retained-detail");
          }).pipe(Effect.provide(Logger.layer([])))
      );
    }
  }

  it.layer(
    Layer.mergeAll(
      TestConsole.layer,
      CliOutput.layer(CliOutput.defaultFormatter({ colors: false }))
    ).pipe(Layer.provideMerge(NodeServices.layer))
  )("local CLI diagnostic boundary", (test) => {
    test.effect(
      "keeps local failure causes without writing them to stdout",
      () =>
        Effect.gen(function* localFailure() {
          const failure = yield* Command.runWith(toCommand(capability), {
            version: "0.0.0",
          })([]).pipe(Effect.flip);

          expect(failure).toBeInstanceOf(PrivateFailure);

          if (!Schema.is(PrivateFailure)(failure)) {
            return yield* Effect.die(failure);
          }

          expect(failure.cause).toBeInstanceOf(Error);
          expect(String(failure.cause)).toContain(secret);
          expect(yield* TestConsole.logLines).toEqual([]);

          return yield* Effect.void;
        })
    );
  });

  for (const schema of [
    Schema.Unknown,
    Schema.Record(Schema.String, Schema.Unknown),
  ]) {
    it.effect(
      `${schema.ast._tag} failures strip causes even when arbitrary object keys are permitted`,
      () =>
        Effect.gen(function* arbitraryFailureSchema() {
          const encoded = yield* Schema.encodeUnknownEffect(
            wireFailureSchema(schema)
          )(
            new PrivateFailure({
              cause: new Error(secret),
              detail: "retained-detail",
            })
          );

          expect(encoded).not.toHaveProperty("cause");
          expect(encoded).toMatchObject({ detail: "retained-detail" });
          expect(JSON.stringify(encoded)).not.toContain(secret);
        }).pipe(Effect.provide(Logger.layer([])))
    );
  }

  it.effect("keeps the original cause in the server log only", () =>
    Effect.gen(function* loggedCause() {
      const messages: unknown[] = [];
      const schema = wireFailureSchema(PrivateFailure);
      const cause = new Error(secret);

      const encoded = yield* Schema.encodeEffect(schema)(
        new PrivateFailure({ cause, detail: "retained-detail" })
      ).pipe(
        Effect.provide(
          Logger.layer([Logger.make(({ message }) => messages.push(message))])
        )
      );

      expect(JSON.stringify(encoded)).not.toContain(secret);
      expect(messages.flat()).toContain(cause);
    })
  );

  it.effect("decodes public failures without recovering private causes", () =>
    Effect.gen(function* decodedFailure() {
      const schema = wireFailureSchema(contract.failure);

      for (const required of [false, true]) {
        const failure = yield* capability
          .handler({ required })
          .pipe(Effect.flip);

        const encoded = yield* Schema.encodeEffect(schema)(failure);
        const decoded = yield* Schema.decodeUnknownEffect(schema)(encoded);
        expect(decoded).toBeInstanceOf(
          required ? RequiredCauseFailure : PrivateFailure
        );
        expect(encoded).not.toHaveProperty("cause");
        expect(decoded.cause).toBe(required ? null : undefined);
      }
    }).pipe(Effect.provide(Logger.layer([])))
  );
});
