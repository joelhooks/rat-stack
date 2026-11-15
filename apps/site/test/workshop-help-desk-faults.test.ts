import { expect, it } from "@effect/vitest";
import { SetupHelpDesk } from "@rat-stack/core/tokenmaxx-help";
import { HelpUnavailable } from "@rat-stack/core/tokenmaxx-help-contracts";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { helpDeskLayer } from "../src/workshop-help/desk.js";
import type { HelpDeskStub } from "../src/workshop-help/desk.js";

const Fault = Schema.Literals([
  "defect",
  "thrown",
  "garbage",
  "wrongFields",
  "interrupted",
]);

const Operation = Schema.Literals(["answer", "file", "find", "list"]);

const faults: Record<typeof Fault.Type, () => Effect.Effect<unknown>> = {
  defect: () => Effect.die(new Error("Durable Object reset")),
  garbage: () => Effect.succeed("not a desk reply"),
  interrupted: () => Effect.interrupt,
  thrown: () =>
    Effect.sync(() => {
      throw new Error("stub threw");
    }),
  wrongFields: () => Effect.succeed({ cursor: 3, reports: "none" }),
};

const faulty = (fault: typeof Fault.Type) => faults[fault];

const stubWith = (fault: typeof Fault.Type): HelpDeskStub => ({
  answer: faulty(fault),
  file: faulty(fault),
  find: faulty(fault),
  list: faulty(fault),
});

const call = (operation: typeof Operation.Type) =>
  Effect.gen(function* callDesk() {
    const desk = yield* SetupHelpDesk;

    const calls: Record<
      typeof Operation.Type,
      Effect.Effect<unknown, HelpUnavailable>
    > = {
      answer: desk.answer("report", "answer"),
      file: desk.file({
        emailHash: "a".repeat(64),
        errorText: null,
        matched: 0,
        os: null,
        redacted: false,
        reportId: "report",
        step: 1,
        symptom: "stuck",
        test: false,
      }),
      find: desk.find("report"),
      list: desk.list({
        cursor: null,
        limit: 10,
        tests: "exclude",
        unansweredOnly: false,
      }),
    };

    yield* Effect.asVoid(calls[operation]);
  });

it.effect.prop(
  "every storage fault, including a Durable Object defect, reaches the caller as the documented 503 storage failure",
  {
    fault: Arbitrary.schema(Fault),
    operation: Arbitrary.schema(Operation),
  },
  ({ fault, operation }) =>
    Effect.gen(function* checkStorageFault() {
      const exit = yield* call(operation).pipe(
        Effect.provide(helpDeskLayer(() => stubWith(fault))),
        Effect.exit
      );

      if (fault === "interrupted") {
        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
        ).toBe(true);

        return;
      }

      const failure = Exit.isFailure(exit)
        ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        : undefined;

      expect(failure).toBeInstanceOf(HelpUnavailable);
      expect(failure).toMatchObject({ reason: "storage" });
    })
);
