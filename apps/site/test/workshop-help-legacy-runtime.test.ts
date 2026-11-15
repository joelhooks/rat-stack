import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import { ConfigProvider, Effect, Schema } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { HttpClient, HttpClientRequest } from "effect/http";

import { emailHashOf } from "../../../packages/core/src/tokenmaxx-help-handlers.js";
import { localServices } from "./fixtures/flag-ledger-client.js";
import { durableObjectValues } from "./fixtures/local-storage.js";
import { plantedOpenAiKey as leakedKey } from "./fixtures/planted-key.js";
import { deployScratch } from "./fixtures/scratch-deploy.js";
import WorkshopHelpWorker from "./fixtures/workshop-help-worker.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `workshop_help_legacy_${process.pid}`,
});

const code = "synthetic-legacy-code";

const operatorToken = "synthetic-legacy-operator";

const ToolReply = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      content: Schema.optional(
        Schema.Array(Schema.Struct({ text: Schema.String }))
      ),
      isError: Schema.optional(Schema.Boolean),
      tools: Schema.optional(
        Schema.Array(Schema.Struct({ name: Schema.String }))
      ),
    }),
  })
);

const Filed = Schema.fromJsonString(
  Schema.Struct({ redacted: Schema.Boolean, reportId: Schema.String })
);

test.provider(
  "an older MCP client files through the Workshop's legacy session object into the same help desk, and session storage keeps no email or code",
  (stack) =>
    Effect.gen(function* checkLegacyHelpPath() {
      const run = (yield* (yield* SecureRandom.SecureRandom).uuidV4()).slice(
        0,
        8
      );

      const email = `legacy.${run}@example.test`;
      const clientName = `HelpLegacy-${run}`;

      const worker = yield* deployScratch(
        stack,
        WorkshopHelpWorker.pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                TOKENMAXX_ATTENDEE_HASHES: JSON.stringify([
                  yield* emailHashOf(email),
                ]),
                TOKENMAXX_HELP_OPERATOR_TOKEN: operatorToken,
                TOKENMAXX_WORKSHOP_CODE: code,
              })
            )
          )
        )
      );

      const origin = yield* Effect.fromNullishOr(worker.url);

      const post = (
        path: string,
        body: Schema.Json,
        headers: Readonly<Record<string, string>> = {}
      ) =>
        HttpClient.execute(
          HttpClientRequest.post(new URL(path, origin)).pipe(
            HttpClientRequest.setHeaders({
              accept: "application/json, text/event-stream",
              ...headers,
            }),
            HttpClientRequest.bodyText(JSON.stringify(body), "application/json")
          )
        ).pipe(
          Effect.flatMap((response) =>
            response.text.pipe(
              Effect.map((text) => ({
                session: response.headers["mcp-session-id"] ?? "",
                status: response.status,
                text,
              }))
            )
          )
        );

      const opened = yield* post("/tokenmaxx/mcp", {
        id: 0,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: clientName, version: "1" },
          protocolVersion: "2025-11-25",
        },
      });

      expect(opened.status).toBe(200);
      expect(opened.session).not.toBe("");

      const session = {
        "mcp-protocol-version": "2025-11-25",
        "mcp-session-id": opened.session,
      };

      yield* post(
        "/tokenmaxx/mcp",
        { jsonrpc: "2.0", method: "notifications/initialized" },
        session
      );

      const tools = yield* post(
        "/tokenmaxx/mcp",
        { id: 1, jsonrpc: "2.0", method: "tools/list", params: {} },
        session
      ).pipe(
        Effect.flatMap(({ text }) => Schema.decodeEffect(ToolReply)(text))
      );

      const names = (tools.result.tools ?? []).map((tool) => tool.name);

      expect(names).toContain("reportSetupProblem");
      expect(names).toContain("setupProblemStatus");
      expect(names).not.toContain("listSetupProblems");
      expect(names).not.toContain("setupHelpStatus");

      const called = yield* post(
        "/tokenmaxx/mcp",
        {
          id: 2,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              code,
              email,
              errorText: `herdr: command not found\nOPENAI_API_KEY=${leakedKey}`,
              step: 3,
              symptom: `herdr is missing, mail ${email}`,
            },
            name: "reportSetupProblem",
          },
        },
        session
      ).pipe(
        Effect.flatMap(({ text }) => Schema.decodeEffect(ToolReply)(text))
      );

      expect(called.result.isError).not.toBe(true);

      const filed = yield* Schema.decodeEffect(Filed)(
        called.result.content?.[0]?.text ?? ""
      );

      expect(filed.redacted).toBe(true);

      const listed = yield* post(
        "/tokenmaxx/api/listSetupProblems",
        { unansweredOnly: true },
        { authorization: `Bearer ${operatorToken}` }
      );

      expect(listed.status).toBe(200);
      expect(listed.text).toContain(filed.reportId);
      expect(listed.text).not.toContain(email);
      expect(listed.text).not.toContain(leakedKey);

      const status = yield* post("/tokenmaxx/api/setupProblemStatus", {
        code,
        email,
        reportId: filed.reportId,
      });

      expect(status.status).toBe(200);
      expect(status.text).toContain('"state":"open"');

      const everyRun = yield* durableObjectValues("WorkshopLegacyMcp");

      const thisRun = new Set(
        everyRun
          .filter((entry) => entry.text.includes(run))
          .map((entry) => entry.database)
      );

      const stored = everyRun.filter((entry) => thisRun.has(entry.database));

      expect(stored.some((entry) => entry.text.includes(clientName))).toBe(
        true
      );

      for (const entry of stored) {
        expect(entry.text).not.toContain(email);
        expect(entry.text).not.toContain(code);
        expect(entry.text).not.toContain(leakedKey);
      }
    }).pipe(Effect.provide(localServices), Effect.orDie)
);
