import { expect, it } from "@effect/vitest";
import { toHttpApi } from "@rat-stack/capability/http-api";
import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { toToolkit } from "@rat-stack/capability/toolkit";
import {
  LearnError,
  LearnUnauthenticated,
  learnFeedbackPollContract,
} from "@rat-stack/core/learn";
import { Effect, Schema } from "effect";

import { learnFeedbackPoll } from "../src/feedback-capabilities.js";
import { loadFeedbackMachine } from "../src/feedback-loader.js";

it.effect("reports a rejected feedback machine chunk as LearnError", () =>
  Effect.gen(function* reportFeedbackLoadFailure() {
    const failure = yield* Effect.flip(
      loadFeedbackMachine(
        Promise.reject(new Error("feedback chunk unavailable"))
      )
    );

    expect(failure._tag).toBe("LearnError");
    expect(failure.id).toBe("feedback");
    expect(failure.reason).toContain("feedback chunk unavailable");
  })
);

it.effect(
  "projects chunk outages separately from authentication refusal across HTTP, MCP and RPC",
  () =>
    Effect.gen(function* projectedFeedbackFailures() {
      const http = toHttpApi("FeedbackLoading", [learnFeedbackPoll]);
      const document = http.openApi();
      const responses = document.paths["/learnFeedbackPoll"]?.post?.responses;

      expect(responses).toHaveProperty("401");
      expect(responses).toHaveProperty("422");
      expect(JSON.stringify(responses?.["401"])).toContain("Unauthenticated");
      expect(JSON.stringify(responses?.["422"])).toContain("LearnError");

      const tools = toToolkit([learnFeedbackPoll]);
      const group = toRpcGroup([learnFeedbackPollContract]);

      const rpc = yield* Effect.fromNullishOr(
        group.group.requests.get("learnFeedbackPoll")
      ).pipe(Effect.orDie);

      for (const failure of [
        new LearnError({
          id: "feedback",
          reason: "feedback chunk unavailable",
        }),
        new LearnUnauthenticated({ message: "Approve a new device code" }),
      ]) {
        const wire = yield* Schema.encodeEffect(
          learnFeedbackPollContract.failure
        )(failure);

        const toolError = yield* Schema.decodeEffect(
          tools.toolkit.tools.learnFeedbackPoll.failureSchema
        )(wire);

        const rpcError = yield* Schema.decodeEffect(rpc.errorSchema)(wire);

        expect(toolError._tag).toBe(failure._tag);
        expect(rpcError._tag).toBe(failure._tag);
      }
    })
);
