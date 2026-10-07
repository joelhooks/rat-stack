import { gateOutcome, runCheck } from "@rat-stack/check-harness";
import type { Verdict } from "@rat-stack/check-harness";
import { Clock, DateTime, Effect, Option, Schema } from "effect";
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

const TimeoutResponse = Schema.TaggedStruct("SandboxError", {
  reason: Schema.Literal("timeout"),
});

const ReadyResponse = Schema.Struct({
  cacheHit: Schema.optionalKey(Schema.Boolean),
  cached: Schema.optionalKey(Schema.Boolean),
  level: Schema.optionalKey(Schema.Finite),
  levelName: Schema.optionalKey(Schema.String),
  scannedAt: Schema.optionalKey(Schema.String),
  siteError: Schema.optionalKey(Schema.Struct({ httpStatus: Schema.Finite })),
});

interface ReadinessObservation {
  readonly document: typeof ReadyResponse.Type;
  readonly status: number;
}

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

export const settledReadinessCheck = Effect.fn("settledReadinessCheck")(
  function* settledReadinessCheck<E, R>(
    work: Effect.Effect<ReadinessObservation, E, R>,
    appliedAt: number
  ) {
    const attempts: Verdict[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = yield* Clock.currentTimeMillis;

      const verdict = yield* runCheck(
        "agent-readiness",
        Effect.gen(function* observeReadiness() {
          const { document, status } = yield* work;

          const scanned =
            document.scannedAt === undefined
              ? Option.none()
              : DateTime.make(document.scannedAt);

          const fresh =
            Option.isSome(scanned) &&
            DateTime.toEpochMillis(scanned.value) >= appliedAt;

          const siteFailed = document.siteError !== undefined;

          const evidence = {
            check: "agent-readiness",
            counts: { observed: 1 },
            observedAt: yield* Clock.currentTimeMillis,
            provenance: [
              {
                fetchedAt: yield* Clock.currentTimeMillis,
                id: `agent-readiness:${attempt + 1}`,
                source: "https://isitagentready.com/api/scan",
                status: `http=${status};scan=${document.scannedAt ?? "missing"};cached=${document.cached ?? "unknown"};cacheHit=${document.cacheHit ?? "unknown"};siteHttp=${document.siteError?.httpStatus ?? "none"}`,
              },
            ],
          };

          if (!siteFailed && !fresh) {
            return {
              ...evidence,
              control: 0,
              exitCode: 3,
              outcome: "errored",
              reason: "readiness-scan-freshness-unverified",
              status: "hold",
            } satisfies Verdict;
          }

          const passed = status === 200 && !siteFailed && document.level === 5;

          const failureReason = siteFailed
            ? "scanner-reported-site-error"
            : "behavior-mismatch";

          return {
            ...evidence,
            control: 1,
            reason: passed ? "behavior-confirmed" : failureReason,
            ...(passed
              ? { exitCode: 0, outcome: "passed", status: "green" }
              : { exitCode: 2, outcome: "failed", status: "red" }),
          } satisfies Verdict;
        })
      );

      const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
      attempts.push({ ...verdict, counts: { ...verdict.counts, durationMs } });

      if (gateOutcome(verdict) === "pass" || attempt === 1) {
        return {
          ...verdict,
          counts: {
            ...verdict.counts,
            attempts: attempts.length,
            failedAttempts: attempts.filter(
              (row) => gateOutcome(row) !== "pass"
            ).length,
          },
          provenance: attempts.flatMap((row, index) => [
            {
              fetchedAt: row.observedAt,
              id: `attempt:${index + 1}`,
              source: "https://isitagentready.com/api/scan",
              status: `${row.status}:${row.reason}:durationMs=${row.counts.durationMs}`,
            },
            ...(row.provenance ?? []),
          ]),
        } satisfies Verdict;
      }
    }

    return yield* Effect.die("readiness-attempts-exhausted-without-verdict");
  }
);

export const contentVersionCheck = Effect.fn("contentVersionCheck")(
  function* contentVersionCheck(
    base: string,
    route: string,
    generation: string
  ) {
    const client = yield* HttpClient.HttpClient;
    const observedAt = yield* Clock.currentTimeMillis;
    const url = `${base}${route}?__rat_version=${encodeURIComponent(generation)}&__rat_probe=${observedAt}`;

    return yield* runCheck(
      `content-version:${route}`,
      Effect.gen(function* observeContentVersion() {
        const response = yield* client.execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeaders({
              accept: "text/markdown",
              "accept-encoding": "identity",
            })
          )
        );

        const { etag } = response.headers;

        const evidence = {
          check: `content-version:${route}`,
          counts: { observed: 1 },
          deploymentVersion: generation,
          observedAt,
          provenance: [
            {
              fetchedAt: observedAt,
              id: route,
              source: url,
              status: `http=${response.status};etag=${etag ?? "missing"}`,
            },
          ],
        };

        if (etag === undefined || etag.trim().length === 0) {
          return {
            ...evidence,
            control: 0,
            exitCode: 3,
            outcome: "errored",
            reason: "content-version-header-missing",
            status: "hold",
          } satisfies Verdict;
        }

        const passed =
          response.status === 200 &&
          etag.replace(/^W\//u, "") ===
            `"${generation}:default:${encodeURIComponent(route)}"`;

        return {
          ...evidence,
          control: 1,
          reason: passed
            ? "content-version-confirmed"
            : "content-version-mismatch",
          resourceVersion: etag,
          ...(passed
            ? { exitCode: 0, outcome: "passed", status: "green" }
            : { exitCode: 2, outcome: "failed", status: "red" }),
        } satisfies Verdict;
      })
    );
  }
);

export const postDeployChecks = Effect.fn("postDeployChecks")(
  function* postDeployChecks(
    base: string,
    contentGeneration: string,
    appliedAt: number
  ) {
    const client = yield* HttpClient.HttpClient;
    const url = base.replace(/\/$/u, "");

    const verdicts: Verdict[] = [
      yield* contentVersionCheck(url, "/", contentGeneration),
      yield* contentVersionCheck(url, "/index.md", contentGeneration),
    ];

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
      yield* settledReadinessCheck(
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

          return { document, status: response.status };
        }),
        appliedAt
      )
    );

    return verdicts;
  },
  Effect.scoped
);
