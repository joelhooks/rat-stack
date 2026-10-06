import { expect, it } from "@effect/vitest";
import { Approval, ApprovalDenied } from "@rat-stack/capability/approval";
import { Effect, Result, Schema } from "effect";

import { capabilityInteraction } from "../src/interaction.js";

it.effect.prop(
  "Alchemy confirmations pass the exact request through the capability approval gate",
  { granted: Schema.Boolean, message: Schema.String },
  ({ granted, message }) =>
    Effect.gen(function* test() {
      const calls: { readonly capability: string; readonly input: unknown }[] =
        [];

      const interaction = yield* capabilityInteraction.pipe(
        Effect.provideService(
          Approval,
          Approval.of({
            approve: (capability, input) =>
              Effect.suspend(() => {
                calls.push({ capability, input });

                return granted
                  ? Effect.void
                  : Effect.fail(
                      new ApprovalDenied({
                        capabilityName: capability,
                        reason: "owner-refused",
                      })
                    );
              }),
          })
        )
      );

      const result = yield* interaction.prompt
        .confirm({ message })
        .pipe(Effect.result);

      expect(calls).toStrictEqual([
        {
          capability: "deployProd",
          input: { message, operation: "alchemy-confirm" },
        },
      ]);
      expect(Result.isSuccess(result)).toBe(granted);

      if (Result.isSuccess(result)) {
        expect(result.success).toBe(true);
      } else {
        expect(result.failure._tag).toBe("NonInteractiveTerminal");
      }
    }),
  { arbitrary: { runs: 100 } }
);

it.effect(
  "headless input and authorization prompts fail typed instead of inventing answers",
  () =>
    Effect.gen(function* test() {
      const interaction = yield* capabilityInteraction.pipe(
        Effect.provide(Approval.denyAll)
      );

      const prompts = [
        interaction.prompt.text({ message: "input" }).pipe(Effect.asVoid),
        interaction.prompt
          .password({ message: "password" })
          .pipe(Effect.asVoid),
        interaction.prompt
          .select<string>({ message: "select", options: [] })
          .pipe(Effect.asVoid),
        interaction.prompt
          .multiSelect<string>({ message: "select", options: [] })
          .pipe(Effect.asVoid),
        interaction.prompt
          .awaitExternal({ message: "external", waitingLabel: "waiting" })
          .pipe(Effect.asVoid),
      ];

      for (const prompt of prompts) {
        const result = yield* Effect.result(prompt);

        expect(Result.isFailure(result)).toBe(true);

        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe("NonInteractiveTerminal");
        }
      }
    })
);
