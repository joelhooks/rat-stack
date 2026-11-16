import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Effect,
  FileSystem,
  Layer,
  Logger,
  Path,
  Predicate,
  Schema,
} from "effect";
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

const NestedFailure = Schema.Struct({
  cause: Schema.Defect(),
  detail: Schema.String,
});

const diagnostics = {
  nested: { cause: new Error(secret), detail: "nested-detail" },
  records: { entry: { cause: new Error(secret), detail: "record-detail" } },
  array: [{ cause: new Error(secret), detail: "array-detail" }],
  tuple: Schema.Tuple([NestedFailure]).make([
    { cause: new Error(secret), detail: "tuple-detail" },
  ]),
  suspended: { cause: new Error(secret), detail: "suspended-detail" },
  union: { cause: new Error(secret), detail: "union-detail" },
};

class PrivateFailure extends Schema.TaggedError<
  PrivateFailure,
  { readonly brand: unique symbol }
>()("PrivateFailure", {
  cause: Schema.optionalKey(Schema.Defect()),
  detail: Schema.String,
  diagnostics: Schema.optionalKey(
    Schema.Struct({
      nested: NestedFailure,
      records: Schema.Record(Schema.String, NestedFailure),
      array: Schema.Array(NestedFailure),
      tuple: Schema.Tuple([NestedFailure]),
      suspended: Schema.suspend(() => NestedFailure),
      union: Schema.Union([Schema.String, NestedFailure]),
    })
  ),
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
          diagnostics,
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
    response: (required: boolean, messages: unknown[]) =>
      Effect.gen(function* rpcResponse() {
        const projection = toRpc([capability]);

        const server = RpcServer.layerHttp({
          group: projection.group,
          path: "/rpc",
          protocol: "http",
        }).pipe(
          Layer.provideMerge(projection.layer),
          Layer.provide(RpcSerialization.layerJson),
          Layer.provideMerge(
            Logger.layer([
              Logger.make(({ message }) => {
                messages.push(message);
              }),
            ])
          )
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
    response: (required: boolean, messages: unknown[]) =>
      Effect.gen(function* mcpResponse() {
        const projection = toToolkit([capability]);

        const server = McpServer.toolkit(projection.toolkit).pipe(
          Layer.provideMerge(projection.layer),
          Layer.provide(serverLayer),
          Layer.provideMerge(
            Logger.layer([
              Logger.make(({ message }) => {
                messages.push(message);
              }),
            ])
          )
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

interface RecursiveFailureValue {
  readonly cause: unknown;
  readonly detail: string;
  readonly children: readonly RecursiveFailureValue[];
}

const RecursiveFailure: Schema.Codec<RecursiveFailureValue> = Schema.suspend(
  () =>
    Schema.Struct({
      cause: Schema.Unknown,
      detail: Schema.String,
      children: Schema.Array(RecursiveFailure),
    })
);

describe("contract failure privacy", () => {
  it.effect.prop(
    "recursive suspended failures redact and restore every declared level",
    { depth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })) },
    ({ depth }) =>
      Effect.gen(function* recursiveFailure() {
        let input: RecursiveFailureValue = {
          cause: secret,
          detail: "retained",
          children: [],
        };

        for (let index = 0; index < depth; index += 1) {
          input = { cause: secret, detail: "retained", children: [input] };
        }

        const schema = wireFailureSchema(RecursiveFailure);
        const encoded = yield* Schema.encodeEffect(schema)(input);
        expect(JSON.stringify(encoded)).not.toContain(secret);
        const decoded = yield* Schema.decodeUnknownEffect(schema)(encoded);
        let node = decoded;

        for (let index = 0; index <= depth; index += 1) {
          expect(node.cause).toBeNull();
          expect(node.detail).toBe("retained");
          node = node.children[0] ?? node;
        }
      }).pipe(Effect.provide(Logger.layer([]))),
    { arbitrary: { runs: 10 } }
  );

  for (const surface of surfaces) {
    for (const required of [false, true]) {
      it.effect(
        `${surface.name} strips ${required ? "required" : "optional"} causes without losing public fields`,
        () =>
          Effect.gen(function* publicResponse() {
            const messages: unknown[] = [];

            const response = yield* Effect.gen(function* request() {
              return yield* surface.response(required, messages);
            }).pipe(
              Effect.provide(
                Logger.layer([
                  Logger.make(({ message }) => {
                    messages.push(message);
                  }),
                ])
              )
            );

            expect(
              messages.filter(
                (message) =>
                  Array.isArray(message) &&
                  message[0] === "Capability failure cause"
              )
            ).toHaveLength(1);

            if (!required) {
              for (const name of [
                "nested",
                "record",
                "array",
                "tuple",
                "suspended",
                "union",
              ]) {
                expect(response).toContain(`${name}-detail`);
              }

              expect(response).not.toContain('"cause":{"name"');
            }

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

  for (const opaque of [
    Schema.Unknown,
    Schema.Any,
    Schema.declare((value): value is object => Predicate.isObject(value)),
  ]) {
    it.effect(
      `${opaque.ast._tag} retains undeclared nested fields as a documented limit`,
      () =>
        Effect.gen(function* opaqueLimit() {
          const schema = wireFailureSchema(Schema.Struct({ details: opaque }));

          const encoded = yield* Schema.encodeEffect(schema)({
            details: { child: { cause: secret } },
          });

          expect(JSON.stringify(encoded)).toContain(secret);
        })
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
