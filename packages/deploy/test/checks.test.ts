import { expect, it } from "@effect/vitest";
import { SandboxDiagnostic } from "@rat-stack/capability";
import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { gateOutcome } from "@rat-stack/check-harness";
import { searchContract } from "@rat-stack/core/contracts";
import { Effect, Layer, Predicate, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";

import {
  contentVersionRetryDefaults,
  postDeployChecks,
  rpcSearchCheck,
} from "../src/checks.js";

const { group: searchGroup } = toRpcGroup([searchContract]);

const searchServer = (matchCount: number) =>
  RpcServer.toHttpEffect(searchGroup).pipe(
    Effect.provide(
      Layer.mergeAll(
        searchGroup.toLayer({
          search: ({ query }) =>
            Effect.succeed({
              matches: Array.from({ length: matchCount }, (_, index) => ({
                description: `Match ${index} for ${query}`,
                digest: `digest-${index}`,
                excerpt: query,
                id: `ratstack://lore/match-${index}`,
                kind: "lore" as const,
                routePath: `/lore/match-${index}`,
                score: 1,
                title: `Match ${index}`,
              })),
              total: matchCount,
            }),
        }),
        RpcSerialization.layerJson
      )
    )
  );

const isRpcUrl = (url: string) => /^\/rpc\/?$/u.test(new URL(url).pathname);

const answerRpc = (
  server: Effect.Success<ReturnType<typeof searchServer>>,
  request: HttpClientRequest.HttpClientRequest,
  body: string
) =>
  server.pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(
        new Request(request.url, {
          body,
          headers: request.headers,
          method: request.method,
        })
      )
    ),
    Effect.scoped,
    Effect.map((response) =>
      HttpClientResponse.fromWeb(request, HttpServerResponse.toWeb(response))
    )
  );

const bodyFor = (url: string, body: string) => {
  if (url === "https://isitagentready.com/api/scan") {
    return {
      level: 5,
      levelName: "Agent-Native",
      scannedAt: "2026-10-06T06:00:00.000Z",
    };
  }

  if (url.endsWith("/openapi.json")) {
    return {
      paths: { "/api/execute": { post: { responses: { "429": {} } } } },
    };
  }

  if (url.endsWith("/mcp")) {
    if (body.includes("tools/list")) {
      return {
        result: {
          tools: ["search", "read", "execute"].map((name) => ({ name })),
        },
      };
    }

    return {
      result: {
        structuredContent: {
          matches: [{ id: "ratstack://skills/learn-rat-stack" }],
        },
      },
    };
  }

  if (body.includes("while(true)")) {
    return {
      diagnostic: SandboxDiagnostic.make({
        kind: "TimeoutExceeded",
        message: "The program exceeded its time limit",
      }),
      result: null,
    };
  }

  if (body.includes("fetch")) {
    return {
      diagnostic: SandboxDiagnostic.make({
        kind: "ExecutionFailure",
        message:
          "This worker is not permitted to access the internet via global functions",
      }),
      result: null,
    };
  }

  return {
    result: {
      id: "ratstack://skills/learn-rat-stack",
      text: "fixture skill content",
    },
  };
};

it.effect.prop(
  "a missing route or malformed protocol response cannot establish health",
  { broken: Schema.Boolean, matchesGeneration: Schema.Boolean },
  ({ broken, matchesGeneration }) =>
    Effect.gen(function* test() {
      const requests: string[] = [];
      const rpc = yield* searchServer(1);

      const client = HttpClient.make((request) => {
        requests.push(request.url);
        let body = "";

        if (Predicate.isTagged(request.body, "Uint8Array")) {
          body = new TextDecoder().decode(request.body.body);
        }

        if (isRpcUrl(request.url) && !broken) {
          return answerRpc(rpc, request, body);
        }

        const value = bodyFor(request.url, body);

        const response = Response.json(broken ? {} : value, {
          headers: {
            "content-type": "application/json",
            etag: `W/"${matchesGeneration ? "test-generation" : "old-generation"}:default:${encodeURIComponent(new URL(request.url).pathname)}"`,
          },
          status: broken ? 503 : 200,
        });

        return Effect.succeed(HttpClientResponse.fromWeb(request, response));
      });

      const results = yield* postDeployChecks(
        "https://example.com",
        "test-generation",
        0,
        { ...contentVersionRetryDefaults, deadlineMs: 0 }
      ).pipe(Effect.provideService(HttpClient.HttpClient, client));

      expect(results.every((result) => gateOutcome(result) === "pass")).toBe(
        !broken && matchesGeneration
      );
      expect(requests).toHaveLength(broken ? 16 : 15);
      expect(results).toHaveLength(15);
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 50 } }
);

it.effect.prop(
  "sandbox health requires HTTP success, matching diagnostics, refused fetch, and null results",
  {
    httpSuccess: Schema.Boolean,
    networkKind: Schema.Literals(["ExecutionFailure", "TimeoutExceeded"]),
    nullResult: Schema.Boolean,
    refusedFetch: Schema.Boolean,
    timeoutKind: Schema.Literals(["TimeoutExceeded", "ExecutionFailure"]),
  },
  ({ httpSuccess, nullResult, timeoutKind, networkKind, refusedFetch }) =>
    Effect.gen(function* qualifiesSandboxDiagnostics() {
      const rpc = yield* searchServer(1);

      const client = HttpClient.make((request) => {
        const body = Predicate.isTagged(request.body, "Uint8Array")
          ? new TextDecoder().decode(request.body.body)
          : "";

        if (isRpcUrl(request.url)) {
          return answerRpc(rpc, request, body);
        }

        const timeout = body.includes("while(true)");
        const network = body.includes("fetch");
        const sandbox = timeout || network;

        const value = sandbox
          ? {
              diagnostic: SandboxDiagnostic.make({
                kind: timeout ? timeoutKind : networkKind,
                message:
                  network && refusedFetch
                    ? "This worker is not permitted to access the internet"
                    : "Unrelated execution failure",
              }),
              result: nullResult ? null : 1,
            }
          : bodyFor(request.url, body);

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(value, {
              headers: { etag: 'W/"test-generation:default:route"' },
              status: sandbox && !httpSuccess ? 500 : 200,
            })
          )
        );
      });

      const results = yield* postDeployChecks(
        "https://example.com",
        "test-generation",
        0,
        { ...contentVersionRetryDefaults, deadlineMs: 0 }
      ).pipe(Effect.provideService(HttpClient.HttpClient, client));

      const timeout = results.find((row) => row.check === "sandbox-timeout");

      const network = results.find(
        (row) => row.check === "sandbox-network-refused"
      );

      expect(timeout?.outcome).toBe(
        httpSuccess && nullResult && timeoutKind === "TimeoutExceeded"
          ? "passed"
          : "failed"
      );
      expect(network?.outcome).toBe(
        httpSuccess &&
          nullResult &&
          networkKind === "ExecutionFailure" &&
          refusedFetch
          ? "passed"
          : "failed"
      );
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 100 } }
);

it.effect.prop(
  "browser search is healthy only when POST /rpc answers 200 with a match",
  {
    matchCount: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
    status: Schema.Literals([200, 404, 503]),
  },
  ({ matchCount, status }) =>
    Effect.gen(function* qualifiesBrowserSearch() {
      const rpc = yield* searchServer(matchCount);
      const seen: string[] = [];

      const client = HttpClient.make((request) => {
        seen.push(
          `${request.method} ${isRpcUrl(request.url) ? "rpc" : request.url}`
        );

        const body = Predicate.isTagged(request.body, "Uint8Array")
          ? new TextDecoder().decode(request.body.body)
          : "";

        return status === 200
          ? answerRpc(rpc, request, body)
          : Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response("Not found", { status })
              )
            );
      });

      const verdict = yield* rpcSearchCheck("https://example.com").pipe(
        Effect.provideService(HttpClient.HttpClient, client)
      );

      expect(seen).toStrictEqual(["POST rpc"]);
      expect(gateOutcome(verdict) === "pass").toBe(
        status === 200 && matchCount > 0
      );
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 50 } }
);
