import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defineContract } from "../src/contract.js";
import { toWebMcp } from "../src/to-web-mcp.js";
import type { WebMcpContext, WebMcpTool } from "../src/to-web-mcp.js";

class NoReading extends Schema.TaggedError<
  NoReading,
  { readonly brand: unique symbol }
>()("NoReading", {
  cause: Schema.Unknown,
  reason: Schema.String,
}) {}

const readingContract = defineContract("reading", {
  annotations: { openWorld: true, readOnly: true, title: "Read a channel" },
  description: "Read the channel at the given offset.",
  failure: NoReading,
  input: Schema.Struct({ offset: Schema.FiniteFromString }),
  output: Schema.Struct({ value: Schema.FiniteFromString }),
});

const modelContext = () => {
  const tools: WebMcpTool[] = [];

  const context: WebMcpContext = {
    registerTool(tool, { signal }) {
      tools.push(tool);
      signal.addEventListener(
        "abort",
        () => {
          tools.length = 0;
        },
        { once: true }
      );

      return Promise.resolve();
    },
  };

  return { context, tools };
};

it.effect.prop(
  "decodes and encodes through the shared contract for each offset",
  { offset: Schema.Int },
  ({ offset }) =>
    Effect.gen(function* webMcpCodecRoundTrip() {
      const { context, tools } = modelContext();
      const signal = yield* Effect.abortSignal;
      yield* toWebMcp([readingContract]).register(
        context,
        {
          reading: ({ offset: decoded }) =>
            Effect.succeed({ value: decoded + 1 }),
        },
        { signal }
      );

      const tool = yield* Effect.fromNullishOr(tools[0]);
      expect(tool.title).toBe("Read a channel");
      expect(tool.annotations).toEqual({
        consequentialHint: false,
        readOnlyHint: true,
        untrustedContentHint: true,
      });

      const result = yield* Effect.promise(() =>
        tool.execute({ offset: String(offset) })
      );

      expect(result).toEqual({ value: String(offset + 1) });
    })
);

it.effect(
  "rejects invalid input without dispatch, exposes only typed failure text, and unregisters on abort",
  () =>
    Effect.gen(function* webMcpFailureAndAbort() {
      const { context, tools } = modelContext();
      const controller = new AbortController();
      const invoked: number[] = [];
      yield* toWebMcp([readingContract]).register(
        context,
        {
          reading: ({ offset }) =>
            Effect.sync(() => invoked.push(offset)).pipe(
              Effect.andThen(
                Effect.fail(
                  new NoReading({
                    cause: "private detail",
                    reason: "No such channel.",
                  })
                )
              )
            ),
        },
        { signal: controller.signal }
      );

      const tool = yield* Effect.fromNullishOr(tools[0]);
      yield* Effect.promise(() =>
        expect(tool.execute({ offset: "not a number" })).rejects.toThrow()
      );
      expect(invoked).toEqual([]);
      yield* Effect.promise(() =>
        expect(tool.execute({ offset: "7" })).rejects.toThrow(
          /^No such channel\.$/u
        )
      );
      expect(invoked).toEqual([7]);
      controller.abort();
      expect(tools).toEqual([]);
    })
);
