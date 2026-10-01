import { describe, expect, it } from "@effect/vitest";
import { ContactRefSchema, IntakeEvents } from "@rat-stack/core/intake";
import type { IntakeStatement } from "@rat-stack/core/intake";
import { Effect, Layer, Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

import {
  makeMemoryIntakeVault,
  SealedStatementSchema,
  sealedIntakeEventsLayer,
  unsealResult,
} from "../src/index.js";

const contact = Schema.decodeSync(ContactRefSchema);

const contacts = [contact("contact-a"), contact("contact-b")] as const;

const ids = [
  "0199a000-0000-7000-8000-000000000001",
  "0199a000-0000-7000-8000-000000000002",
  "0199a000-0000-7000-8000-000000000003",
] as const;

const Step = Schema.Union([
  Schema.Struct({
    actor: Schema.Literals([0, 1]),
    id: Schema.Literals([0, 1, 2]),
    kind: Schema.Literal("record"),
    response: Schema.String,
  }),
  Schema.Struct({
    actor: Schema.Literals([0, 1]),
    kind: Schema.Literal("erase"),
  }),
]);

const steps = Arbitrary.array(Arbitrary.schema(Step), { maxLength: 20 });

const statementOf = (
  actorIndex: 0 | 1,
  idIndex: 0 | 1 | 2,
  response: string
): IntakeStatement => ({
  actor: contacts[actorIndex],
  context: { intake: "tokenmaxx", submissionId: `submission-${actorIndex}` },
  id: ids[idIndex],
  object: "tokenmaxx/questions/building",
  result: { response: `answer:${response}` },
  timestamp: "2026-10-01T18:00:00.000Z",
  verb: "answered",
});

const decodeRow = Schema.decodeUnknownSync(
  Schema.fromJsonString(SealedStatementSchema)
);

describe("sealed intake events", () => {
  it.effect.prop(
    "stores each statement once, sealed under its contact's key, and erases a contact whole",
    { generated: steps },
    ({ generated }) =>
      Effect.gen(function* replay() {
        const vault = yield* makeMemoryIntakeVault;

        const events = yield* Effect.service(IntakeEvents).pipe(
          Effect.provide(
            sealedIntakeEventsLayer.pipe(Layer.provide(vault.layer))
          )
        );

        const expected = new Map<string, Map<string, IntakeStatement>>();

        for (const step of generated) {
          const actor = contacts[step.actor];

          if (step.kind === "erase") {
            yield* events.erase(actor);
            expected.delete(actor);
            continue;
          }

          const statement = statementOf(step.actor, step.id, step.response);
          yield* events.record([statement]);

          const held =
            expected.get(actor) ?? new Map<string, IntakeStatement>();

          if (!held.has(statement.id)) {
            held.set(statement.id, statement);
          }

          expected.set(actor, held);
        }

        const stored = yield* vault.contents;

        expect([...stored.keys()].toSorted()).toStrictEqual(
          [...expected.keys()]
            .filter((actor) => (expected.get(actor)?.size ?? 0) > 0)
            .toSorted()
        );

        for (const [actor, held] of stored) {
          const want =
            expected.get(actor) ?? new Map<string, IntakeStatement>();

          expect([...held.rows.keys()].toSorted()).toStrictEqual(
            [...want.keys()].toSorted()
          );

          for (const [id, sealed] of held.rows) {
            const statement = want.get(id);

            expect(sealed).not.toContain("answer:");

            const row = decodeRow(sealed);

            expect(row).toMatchObject({
              actor: statement?.actor,
              id,
              object: statement?.object,
              submissionId: statement?.context.submissionId,
              verb: statement?.verb,
            });
            expect(
              yield* unsealResult(held.key, row.sealedResult ?? "")
            ).toStrictEqual(statement?.result);
          }
        }
      })
  );
});
