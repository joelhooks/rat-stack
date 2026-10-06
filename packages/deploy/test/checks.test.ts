import { expect, it } from "@effect/vitest";
import { gateOutcome } from "@rat-stack/check-harness";
import { Effect, Predicate, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  contentVersionRetryDefaults,
  postDeployChecks,
} from "../src/checks.js";

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
    return Schema.TaggedStruct("SandboxError", {
      reason: Schema.Literal("timeout"),
    }).make({ reason: "timeout" });
  }

  if (body.includes("fetch")) {
    return {
      message:
        "This worker is not permitted to access the internet via global functions",
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

      const client = HttpClient.make((request) => {
        requests.push(request.url);
        let body = "";

        if (Predicate.isTagged(request.body, "Uint8Array")) {
          body = new TextDecoder().decode(request.body.body);
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
      expect(requests).toHaveLength(broken ? 15 : 14);
      expect(results).toHaveLength(14);
    }),
  { arbitrary: { runs: 50 } }
);
