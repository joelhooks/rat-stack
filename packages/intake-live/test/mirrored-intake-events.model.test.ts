import { describe, expect, it } from "@effect/vitest";
import {
  ContactRefSchema,
  IntakeEvents,
  IntakeEventsTest,
  IntakeEventsUnavailable,
} from "@rat-stack/core/intake";
import type { ContactRef, IntakeStatement } from "@rat-stack/core/intake";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { FetchHttpClient } from "effect/http";

import { intakeLiveLayer, mirrorIntakeEvents } from "../src/index.js";
import type { IntakeVaultStub, TicketBindingStub } from "../src/index.js";

const actors = [0, 1] as const;

type Actor = (typeof actors)[number];

const actorOf = (actor: Actor) =>
  Schema.decodeSync(ContactRefSchema)(`contact-${actor}`);

const Step = Schema.Union([
  Schema.Struct({
    actor: Schema.Literals(actors),
    kind: Schema.Literal("record"),
    mirrorDown: Schema.Boolean,
  }),
  Schema.Struct({
    actor: Schema.Literals(actors),
    kind: Schema.Literal("erase"),
    mirrorDown: Schema.Boolean,
  }),
]);

const steps = Arbitrary.array(Arbitrary.schema(Step), { maxLength: 24 });

const statementAt = (actor: Actor, index: number): IntakeStatement => ({
  actor: actorOf(actor),
  context: { intake: "tokenmaxx", submissionId: `submission-${actor}` },
  id: `0199a000-0000-7000-8000-${String(index).padStart(12, "0")}`,
  object: "tokenmaxx/intake",
  timestamp: "2026-10-02T08:32:23.000Z",
  verb: "submitted",
});

const testStore = Effect.gen(function* buildTestStore() {
  const context = yield* Layer.build(IntakeEvents.testLayer);

  return {
    events: Context.get(context, IntakeEvents),
    inspect: Context.get(context, IntakeEventsTest),
  };
});

const idsOf = (statements: readonly IntakeStatement[]) =>
  new Set(statements.map((statement) => statement.id));

const runAgainstModel = (generated: readonly (typeof Step.Type)[]) =>
  Effect.gen(function* mirroredModel() {
    const vault = yield* testStore;
    const basin = yield* testStore;
    const down = yield* Ref.make(false);

    const flakyBasin: IntakeEvents["Service"] = {
      erase: (actor) =>
        Effect.flatMap(Ref.get(down), (isDown) =>
          isDown ? Effect.die("basin down") : basin.events.erase(actor)
        ),
      record: (statements, contact) =>
        Effect.flatMap(Ref.get(down), (isDown) =>
          isDown
            ? Effect.fail(new IntakeEventsUnavailable({}))
            : basin.events.record(statements, contact)
        ),
    };

    const mirrored = mirrorIntakeEvents(vault.events, flakyBasin);
    const expectedVault = new Map<string, ContactRef>();
    const expectedBasin = new Map<string, ContactRef>();

    for (const [index, step] of generated.entries()) {
      yield* Ref.set(down, step.mirrorDown);

      const actor = actorOf(step.actor);

      if (step.kind === "record") {
        const statement = statementAt(step.actor, index);

        const exit = yield* Effect.exit(
          mirrored.record([statement], {
            agentRef: "agent-under-test",
            email: `person-${step.actor}@example.com`,
          })
        );

        expect(Exit.isSuccess(exit)).toBe(true);
        expectedVault.set(statement.id, actor);

        if (!step.mirrorDown) {
          expectedBasin.set(statement.id, actor);
        }

        continue;
      }

      const exit = yield* Effect.exit(mirrored.erase(actor));

      expect(Exit.isSuccess(exit)).toBe(!step.mirrorDown);

      if (!step.mirrorDown) {
        for (const expected of [expectedVault, expectedBasin]) {
          for (const [id, owner] of expected) {
            if (owner === actor) {
              expected.delete(id);
            }
          }
        }
      }
    }

    expect(idsOf(yield* vault.inspect.statements)).toStrictEqual(
      new Set(expectedVault.keys())
    );

    expect(idsOf(yield* basin.inspect.statements)).toStrictEqual(
      new Set(expectedBasin.keys())
    );

    const erasedInBasin = new Set(yield* basin.inspect.erased);

    for (const actor of yield* vault.inspect.erased) {
      expect(erasedInBasin.has(actor)).toBe(true);
    }
  });

describe("mirrored intake events", () => {
  it.effect.prop(
    "keep every record in the vault, mirror it to Basin when Basin is up, and never erase the vault without Basin's erased row",
    { generated: steps },
    ({ generated }) => Effect.scoped(runAgainstModel(generated)),
    { arbitrary: { runs: 300 } }
  );

  it.effect(
    "intakeLiveLayer keeps the sealed vault primary when Basin events are supplied",
    () =>
      Effect.scoped(
        Effect.gen(function* liveLayerKeepsVault() {
          const sealedRows = yield* Ref.make(0);
          const vaultErasures = yield* Ref.make(0);
          const basin = yield* testStore;
          const basinDown = yield* Ref.make(true);

          const flakyBasin: IntakeEvents["Service"] = {
            erase: basin.events.erase,
            record: (statements, contact) =>
              Effect.flatMap(Ref.get(basinDown), (isDown) =>
                isDown
                  ? Effect.fail(new IntakeEventsUnavailable({}))
                  : basin.events.record(statements, contact)
              ),
          };

          const stub: IntakeVaultStub & TicketBindingStub = {
            bindTicket: () => Effect.die("tickets are not under test"),
            intakeErase: () => Ref.update(vaultErasures, (count) => count + 1),
            intakeKey: (candidate) => Effect.succeed(candidate),
            intakeStore: (rows) =>
              Ref.update(sealedRows, (count) => count + rows.length),
          };

          const events = yield* IntakeEvents.pipe(
            Effect.provide(
              intakeLiveLayer({
                events: Layer.succeed(IntakeEvents, flakyBasin),
                interests: () => stub,
                tokenSecret: Redacted.make("intake-test-secret"),
                typesafeApiKey: Option.none(),
              }).pipe(Layer.provide(FetchHttpClient.layer))
            )
          );

          const contact = {
            agentRef: "agent-under-test",
            email: "person-0@example.com",
          };

          yield* events.record([statementAt(0, 0)], contact);

          expect(yield* Ref.get(sealedRows)).toBe(1);
          expect(idsOf(yield* basin.inspect.statements).size).toBe(0);

          yield* Ref.set(basinDown, false);
          yield* events.record([statementAt(0, 1)], contact);

          expect(yield* Ref.get(sealedRows)).toBe(2);
          expect(idsOf(yield* basin.inspect.statements).size).toBe(1);

          yield* events.erase(actorOf(0));

          expect(yield* Ref.get(vaultErasures)).toBe(1);
          expect(yield* basin.inspect.erased).toStrictEqual([actorOf(0)]);
        })
      )
  );
});
