import { expect, it } from "@effect/vitest";
import { gateOutcome } from "@rat-stack/check-harness";
import { Effect, Predicate, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { postDeployChecks } from "../src/checks.js";

const bodyFor = (url: string, body: string) => {
  if (url === "https://isitagentready.com/api/scan") {
    return { level: 5, levelName: "Agent-Native" };
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
  { broken: Schema.Boolean },
  ({ broken }) =>
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
          headers: { "content-type": "application/json" },
          status: broken ? 503 : 200,
        });

        return Effect.succeed(HttpClientResponse.fromWeb(request, response));
      });

      const results = yield* postDeployChecks("https://example.com").pipe(
        Effect.provideService(HttpClient.HttpClient, client)
      );

      expect(results.every((result) => gateOutcome(result) === "pass")).toBe(
        !broken
      );
      expect(requests).toHaveLength(12);
      expect(results).toHaveLength(12);
    }),
  { arbitrary: { runs: 50 } }
);
