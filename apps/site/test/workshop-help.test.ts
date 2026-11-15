import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  SetupHelpAccess,
  SetupHelpGuide,
} from "@rat-stack/core/tokenmaxx-help";
import { WorkshopDirectory } from "@rat-stack/core/workshop-directory";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { HttpRouter } from "effect/http";

import { emailHashOf } from "../../../packages/core/src/tokenmaxx-help-handlers.js";
import { memoryHelpDesk } from "../../../packages/core/test/fixtures/help-desk-memory.js";
import { buildHelpGuide } from "../scripts/tokenmaxx-help.ts";
import { workshopRoutes } from "../src/workshop-runtime.js";
import { plantedOpenAiKey as leakedKey } from "./fixtures/planted-key.js";

const email = "attendee@example.test";

const code = "synthetic-code";

const operatorToken = "synthetic-operator";

const emptyWorkshop = WorkshopDirectory.layer({
  exercises: [],
  links: { links: [], status: "not-yet-published" },
  prep: { items: [], status: "not-yet-published" },
  runs: [],
});

const RpcRequest = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Json,
  tag: Schema.String,
});

const Call = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(Schema.Struct({ text: Schema.String })),
  }),
});

it.effect(
  "an attendee's agent files over MCP, the desk answers over HTTP, and the agent reads the answer",
  () =>
    Effect.gen(function* helpRoundTrip() {
      const { rows } = yield* buildHelpGuide("../..");
      const desk = yield* memoryHelpDesk;

      const help = Layer.mergeAll(
        desk.layer,
        SetupHelpAccess.configLayer({
          attendees: Option.some([yield* emailHashOf(email)]),
          code: Option.some(Redacted.make(code)),
          operatorToken: Option.some(Redacted.make(operatorToken)),
          tests: [],
        }),
        SetupHelpGuide.layer(rows),
        SecureRandom.layerWebCrypto
      );

      const { handler, dispose } = HttpRouter.toWebHandler(
        workshopRoutes.pipe(Layer.provide(Layer.merge(emptyWorkshop, help))),
        { disableLogger: true }
      );

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      const fetch = (path: string, body: Schema.Json, headers = {}) =>
        Effect.promise(() =>
          handler(
            new Request(`https://ratstack.sh${path}`, {
              body: JSON.stringify(body),
              headers: {
                accept: "application/json, text/event-stream",
                "content-type": "application/json",
                ...headers,
              },
              method: "POST",
            })
          )
        ).pipe(
          Effect.flatMap((response) =>
            Effect.promise(() => response.text()).pipe(
              Effect.map((text) => ({ status: response.status, text }))
            )
          )
        );

      const session = yield* Effect.promise(() =>
        handler(
          new Request("https://ratstack.sh/tokenmaxx/mcp", {
            body: JSON.stringify({
              id: 0,
              jsonrpc: "2.0",
              method: "initialize",
              params: {
                capabilities: {},
                clientInfo: { name: "HelpTest", version: "1" },
                protocolVersion: "2025-11-25",
              },
            }),
            headers: {
              accept: "application/json, text/event-stream",
              "content-type": "application/json",
            },
            method: "POST",
          })
        )
      ).pipe(
        Effect.map((response) => ({
          "mcp-protocol-version": "2025-11-25",
          "mcp-session-id": response.headers.get("mcp-session-id") ?? "",
        }))
      );

      yield* fetch(
        "/tokenmaxx/mcp",
        { jsonrpc: "2.0", method: "notifications/initialized" },
        session
      );

      const mcp = (id: number, method: string, params: Schema.Json) =>
        fetch(
          "/tokenmaxx/mcp",
          { id, jsonrpc: "2.0", method, params },
          session
        );

      const tools = yield* mcp(1, "tools/list", {});
      expect(tools.text).toContain("reportSetupProblem");
      expect(tools.text).toContain("setupProblemStatus");
      expect(tools.text).not.toContain("listSetupProblems");
      expect(tools.text).not.toContain("answerSetupProblem");
      expect(tools.text).not.toContain("setupHelpStatus");

      const refused = yield* mcp(2, "tools/call", {
        arguments: { code: "guess", email, step: 1, symptom: "stuck" },
        name: "reportSetupProblem",
      });

      expect(refused.text).toContain('"isError":true');
      expect(refused.text).toContain("match the attendee list");

      const filed = yield* mcp(3, "tools/call", {
        arguments: {
          code,
          email: ` ${email.toUpperCase()}`,
          errorText: `git: command not found\nOPENAI_API_KEY=${leakedKey}`,
          os: "macOS 15",
          step: 1,
          symptom: "npx tiged fails",
        },
        name: "reportSetupProblem",
      });

      expect(filed.text).not.toContain(leakedKey);

      const [content] = (yield* Schema.decodeEffect(
        Schema.fromJsonString(Call)
      )(filed.text)).result.content;

      const reply = yield* Schema.decodeEffect(
        Schema.fromJsonString(
          Schema.Struct({
            guidance: Schema.Array(Schema.Struct({ fix: Schema.String })),
            redacted: Schema.Boolean,
            reportId: Schema.String,
          })
        )
      )(content?.text ?? "");

      expect(reply.redacted).toBe(true);
      expect(reply.guidance.map((entry) => entry.fix)).toStrictEqual([
        "The Mac has no git. Run `xcode-select --install`, accept the dialog, wait a few minutes, run the step again.",
      ]);

      const status = (headers = {}) =>
        fetch(
          "/tokenmaxx/api/setupProblemStatus",
          { code, email, reportId: reply.reportId },
          headers
        );

      expect(yield* status()).toMatchObject({ status: 200 });
      expect((yield* status()).text).toContain('"state":"open"');

      for (const authorization of [undefined, "Bearer wrong", operatorToken]) {
        const denied = yield* fetch(
          "/tokenmaxx/api/listSetupProblems",
          {},
          authorization === undefined ? {} : { authorization }
        );

        expect(denied.status).toBe(401);
      }

      const operator = { authorization: `Bearer ${operatorToken}` };

      const helpStatus = yield* fetch(
        "/tokenmaxx/api/setupHelpStatus",
        {},
        operator
      );

      expect(helpStatus.status).toBe(200);
      expect(JSON.parse(helpStatus.text)).toStrictEqual({
        attendeeCount: 1,
        codeSet: true,
        configured: true,
        operatorSet: true,
        testCount: 0,
      });

      const listed = yield* fetch(
        "/tokenmaxx/api/listSetupProblems",
        { unansweredOnly: true },
        operator
      );

      expect(listed.status).toBe(200);
      expect(listed.text).toContain(reply.reportId);
      expect(listed.text).not.toContain(leakedKey);
      expect(listed.text).not.toContain(email);

      const answered = yield* fetch(
        "/tokenmaxx/api/answerSetupProblem",
        {
          answer: "Run xcode-select --install, then retry.",
          reportId: reply.reportId,
        },
        operator
      );

      expect(answered.status).toBe(200);

      const read = yield* fetch(
        "/tokenmaxx/rpc",
        RpcRequest.make({
          headers: [],
          id: "1",
          payload: { code, email, reportId: reply.reportId },
          tag: "setupProblemStatus",
        })
      );

      expect(read.status).toBe(200);
      expect(read.text).toContain("Run xcode-select --install, then retry.");
      expect(read.text).toContain('"state":"answered"');

      const openapi = yield* Effect.promise(() =>
        handler(new Request("https://ratstack.sh/tokenmaxx/openapi.json"))
      ).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.text()))
      );

      expect(openapi).toContain("reportSetupProblem");
    }).pipe(Effect.provide(NodeServices.layer))
);
