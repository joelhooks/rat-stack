import { runCheck } from "@rat-stack/check-harness";
import type { Verdict } from "@rat-stack/check-harness";
import { Clock, Effect, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const ToolsResponse = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
});

const ExecuteResponse = Schema.Struct({
  result: Schema.Struct({ id: Schema.String, text: Schema.NonEmptyString }),
});

const SearchResponse = Schema.Struct({
  result: Schema.Struct({
    structuredContent: Schema.Struct({
      matches: Schema.Array(Schema.Struct({ id: Schema.String })),
    }),
  }),
});

const TimeoutResponse = Schema.Struct({
  _tag: Schema.Literal("SandboxError"),
  reason: Schema.Literal("timeout"),
});

const ReadyResponse = Schema.Struct({
  level: Schema.Finite,
  levelName: Schema.String,
});

const RateDocument = Schema.Struct({
  paths: Schema.Struct({
    "/api/execute": Schema.Struct({
      post: Schema.Struct({
        responses: Schema.Record(Schema.String, Schema.Unknown),
      }),
    }),
  }),
});

const NetworkResponse = Schema.Union([
  Schema.Struct({ message: Schema.String }),
  Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
  Schema.Struct({ result: Schema.Struct({ message: Schema.String }) }),
]);

export const measuredCheck = <E, R>(
  check: string,
  work: Effect.Effect<boolean, E, R>
) =>
  runCheck(
    check,
    Effect.gen(function* measureBehavior() {
      const passed = yield* work;

      return {
        check,
        control: 1,
        counts: { observed: 1 },
        observedAt: yield* Clock.currentTimeMillis,
        reason: passed ? "behavior-confirmed" : "behavior-mismatch",
        ...(passed
          ? { exitCode: 0, outcome: "passed", status: "green" }
          : { exitCode: 2, outcome: "failed", status: "red" }),
      } satisfies Verdict;
    })
  );

export const postDeployChecks = Effect.fn("postDeployChecks")(
  function* postDeployChecks(base: string) {
    const client = yield* HttpClient.HttpClient;
    const url = base.replace(/\/$/u, "");
    const verdicts: Verdict[] = [];

    for (const route of [
      "/",
      "/llms.txt",
      "/openapi.json",
      "/.well-known/mcp.json",
      "/.well-known/agent-skills/index.json",
    ]) {
      verdicts.push(
        yield* measuredCheck(
          `route:${route}`,
          client
            .get(`${url}${route}`)
            .pipe(Effect.map((response) => response.status === 200))
        )
      );
    }

    const post = (
      route: string,
      json: string,
      headers: Readonly<Record<string, string>> = {}
    ) =>
      client.execute(
        HttpClientRequest.post(`${url}${route}`).pipe(
          HttpClientRequest.setHeaders({
            "content-type": "application/json",
            ...headers,
          }),
          HttpClientRequest.bodyText(json, "application/json")
        )
      );

    const mcpHeaders = {
      "MCP-Protocol-Version": "2026-07-28",
      accept: "application/json, text/event-stream",
    };

    const meta = {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {
        name: "rat-stack-checks",
        version: "0.1.0",
      },
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    };

    verdicts.push(
      yield* measuredCheck(
        "mcp-tools-list",
        Effect.gen(function* toolsList() {
          const response = yield* post(
            "/mcp",
            JSON.stringify({
              id: "deploy-tools",
              jsonrpc: "2.0",
              method: "tools/list",
              params: { _meta: meta },
            }),
            { ...mcpHeaders, "Mcp-Method": "tools/list" }
          );

          const document =
            yield* HttpClientResponse.schemaBodyJson(ToolsResponse)(response);

          return (
            response.status === 200 &&
            ["search", "read", "execute"].every((name) =>
              document.result.tools.some((tool) => tool.name === name)
            )
          );
        })
      ),
      yield* measuredCheck(
        "execute-round-trip",
        Effect.gen(function* executeRoundTrip() {
          const response = yield* post(
            "/api/execute",
            JSON.stringify({
              code: 'const found = await tools.search({ query: "learn-rat-stack", limit: 1 }); return await tools.read({ id: found.matches[0].id });',
            })
          );

          const document =
            yield* HttpClientResponse.schemaBodyJson(ExecuteResponse)(response);

          return (
            response.status === 200 &&
            document.result.id === "ratstack://skills/learn-rat-stack" &&
            document.result.text.trim().length > 0
          );
        })
      ),
      yield* measuredCheck(
        "sandbox-network-refused",
        Effect.gen(function* networkRefused() {
          const response = yield* post(
            "/api/execute",
            JSON.stringify({
              code: 'return await fetch("https://example.com");',
            })
          );

          const document =
            yield* HttpClientResponse.schemaBodyJson(NetworkResponse)(response);

          let message = "";

          if ("message" in document) {
            ({ message } = document);
          } else if ("error" in document) {
            ({ message } = document.error);
          } else {
            ({ message } = document.result);
          }

          return message
            .toLowerCase()
            .includes("not permitted to access the internet");
        })
      ),
      yield* measuredCheck(
        "sandbox-timeout",
        Effect.gen(function* sandboxTimeout() {
          const response = yield* post(
            "/api/execute",
            JSON.stringify({ code: "while(true){}" })
          );

          yield* HttpClientResponse.schemaBodyJson(TimeoutResponse)(response);

          return true;
        })
      ),
      yield* measuredCheck(
        "mcp-search",
        Effect.gen(function* mcpSearch() {
          const response = yield* post(
            "/mcp",
            JSON.stringify({
              id: "deploy-search",
              jsonrpc: "2.0",
              method: "tools/call",
              params: {
                _meta: meta,
                arguments: { limit: 1, query: "learn-rat-stack" },
                name: "search",
              },
            }),
            { ...mcpHeaders, "Mcp-Method": "tools/call", "Mcp-Name": "search" }
          );

          const document =
            yield* HttpClientResponse.schemaBodyJson(SearchResponse)(response);

          return (
            response.status === 200 &&
            document.result.structuredContent.matches.length > 0
          );
        })
      ),
      yield* measuredCheck(
        "execute-429-document",
        Effect.gen(function* rateDocument() {
          const response = yield* client.get(`${url}/openapi.json`);

          const document =
            yield* HttpClientResponse.schemaBodyJson(RateDocument)(response);

          return (
            response.status === 200 &&
            Object.hasOwn(document.paths["/api/execute"].post.responses, "429")
          );
        })
      ),
      yield* measuredCheck(
        "agent-readiness",
        Effect.gen(function* agentReadiness() {
          const response = yield* client.execute(
            HttpClientRequest.post("https://isitagentready.com/api/scan").pipe(
              HttpClientRequest.bodyText(
                JSON.stringify({ url }),
                "application/json"
              )
            )
          );

          const document =
            yield* HttpClientResponse.schemaBodyJson(ReadyResponse)(response);

          return response.status === 200 && document.level === 5;
        })
      )
    );

    return verdicts;
  },
  Effect.scoped
);
