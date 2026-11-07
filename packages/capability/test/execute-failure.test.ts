import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema } from "effect";
import { McpServer } from "effect/ai";
import { CliOutput, Command } from "effect/cli";
import { Etag, HttpPlatform } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcTest } from "effect/rpc";
import { TestConsole } from "effect/testing";

import { ExecuteError } from "../src/execute-error.js";
import { SandboxDiagnostic } from "../src/sandbox-diagnostic-schema.js";
import { Sandbox } from "../src/sandbox-port.js";
import { layerSubprocess } from "../src/sandbox-subprocess.js";
import { toCodeMode, toExecuteCapability } from "../src/to-code-mode.js";
import { toCommand } from "../src/to-command.js";
import { toHttpApi } from "../src/to-http-api.js";
import { toRpc } from "../src/to-rpc.js";
import { echo } from "./fixtures.js";
import { makeMcpClient, serverLayer } from "./mcp-harness.js";

const execute = toExecuteCapability([echo]).capability;

const http = toHttpApi("ExecuteFailureTest", [execute]);

const rpc = toRpc([execute]);

const codeMode = toCodeMode([echo]);

const sandbox = layerSubprocess({ timeout: "5 seconds" }).pipe(
  Layer.provide(NodeServices.layer)
);

const services = Layer.mergeAll(
  Etag.layerWeak,
  HttpPlatform.layer,
  TestConsole.layer,
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  sandbox
).pipe(Layer.provideMerge(NodeServices.layer));

const mcp = McpServer.toolkit(codeMode.toolkit).pipe(
  Layer.provideMerge(codeMode.layer),
  Layer.provide(sandbox),
  Layer.provide(serverLayer)
);

it.effect.prop(
  "generated programs succeed or fail consistently through HTTP, MCP, RPC, and CLI",
  {
    fails: Schema.Boolean,
    value: Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 1 })),
  },
  ({ fails, value }) =>
    Effect.gen(function* projectsProgramOutcome() {
      const message = `program failed ${value}`;
      const code = `console.log("before"); ${fails ? `throw new Error(${JSON.stringify(message)})` : `return ${value}`};`;

      const client = yield* HttpApiTest.groups(http.api, ["capabilities"]).pipe(
        Effect.provide(http.layer)
      );

      const response = yield* client.capabilities.execute({
        payload: { code },
        responseMode: "response-only",
      });

      const body = yield* response.json;

      expect(response.status).toBe(fails ? 422 : 200);
      expect(body).not.toHaveProperty("diagnostic");
      expect(body).toMatchObject({
        logs: ["log: before"],
        toolCalls: [],
        truncated: false,
        ...(fails ? { kind: "ExecutionFailure", message } : { result: value }),
      });

      if (fails) {
        expect(body).toHaveProperty("_tag", "ExecuteError");
        expect(body).not.toHaveProperty("result");
      }

      const mcpClient = yield* makeMcpClient(mcp);

      const toolResult = yield* mcpClient["tools/call"]({
        arguments: { code },
        name: "execute",
      });

      expect(toolResult.isError).toBe(fails);

      if (fails) {
        expect(toolResult.structuredContent).toBeUndefined();
        expect(toolResult.content).toEqual([{ text: message, type: "text" }]);
      } else {
        expect(toolResult.structuredContent).toEqual(body);
      }

      const rpcClient = yield* RpcTest.makeClient(rpc.group).pipe(
        Effect.provide(rpc.layer)
      );

      const outcome = yield* rpcClient.execute({ code }).pipe(Effect.exit);
      expect(Exit.isFailure(outcome)).toBe(fails);

      if (fails) {
        const error = yield* rpcClient.execute({ code }).pipe(Effect.flip);
        const decoded = yield* Schema.decodeUnknownEffect(ExecuteError)(error);
        expect(yield* Schema.encodeEffect(ExecuteError)(decoded)).toEqual(body);
      }

      const command = yield* Command.runWith(toCommand(execute), {
        version: "0.0.0",
      })(["--code", code]).pipe(Effect.exit);

      expect(Exit.isFailure(command)).toBe(fails);
    }).pipe(Effect.provide(services), Effect.scoped),
  { arbitrary: { runs: 12 }, timeout: 30_000 }
);

it.effect.prop(
  "every sandbox diagnostic becomes a typed failure with its bounded execution receipts",
  {
    diagnostic: SandboxDiagnostic,
    logs: Schema.Array(Schema.String),
    truncated: Schema.Boolean,
  },
  ({ diagnostic, logs, truncated }) =>
    Effect.gen(function* preservesFailureReceipts() {
      const failure = yield* execute
        .handler({ code: "program" })
        .pipe(Effect.flip);

      expect(Schema.is(ExecuteError)(failure)).toBe(true);
      expect(failure).toMatchObject({
        ...diagnostic,
        logs,
        toolCalls: ["echo"],
        truncated,
      });
    }).pipe(
      Effect.provideService(Sandbox, {
        run: () =>
          Effect.succeed({
            diagnostic,
            logs,
            result: null,
            toolCalls: ["echo"],
            truncated,
          }),
      })
    )
);

it.effect(
  "the projected execute command exits non-zero only for a failed program",
  () =>
    Effect.gen(function* processExit() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      for (const fails of [false, true]) {
        const script = `
        import { NodeRuntime, NodeServices } from '@effect/platform-node';
        import { Effect, Schema } from 'effect';
        import { Command } from 'effect/cli';
        import { defineContract, implement, toExecuteCapability, toCommand, layerSubprocess } from './dist/index.js';
        const echo = implement(defineContract('echo', { description: 'echo', input: Schema.Struct({}), output: Schema.Json, failure: Schema.Never }), () => Effect.succeed(null));
        const execute = toExecuteCapability([echo]).capability;
        NodeRuntime.runMain(Command.runWith(toCommand(execute), { version: '0.0.0' })(['--code', ${JSON.stringify(fails ? 'throw new Error("boom")' : "return 2")}]).pipe(Effect.provide(layerSubprocess()), Effect.provide(NodeServices.layer)));
      `;

        const code = yield* spawner.exitCode(
          ChildProcess.make(process.execPath, [
            "--input-type=module",
            "-e",
            script,
          ])
        );

        expect(Number(code) === 0).toBe(!fails);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
