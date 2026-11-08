import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import { JoinContactStore, withPending } from "@rat-stack/core/join-interest";
import { Effect, Layer, Option, Redacted, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { joinContactCell } from "../src/interest/join-contact-cell.js";
import type { JoinCellStorage } from "../src/interest/join-contact-cell.js";
import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";

const memoryStorage = Effect.gen(function* makeMemoryStorage() {
  const entries = yield* Ref.make<ReadonlyMap<string, unknown>>(new Map());

  const storage: JoinCellStorage = {
    delete: (key) =>
      Ref.update(entries, (current) => {
        const next = new Map(current);

        next.delete(key);

        return next;
      }),
    get: (key) =>
      Ref.get(entries).pipe(Effect.map((current) => current.get(key))),
    put: (key, value) =>
      Ref.update(entries, (current) => new Map(current).set(key, value)),
  };

  return storage;
});

const Command = Schema.Union([
  Schema.Struct({ erase: Schema.Boolean, kind: Schema.Literal("save") }),
  Schema.Struct({ kind: Schema.Literal("erase") }),
]);

interface CellModel {
  readonly erased: boolean;
  readonly marked: boolean;
  readonly sealed: string | undefined;
}

const step = (
  model: CellModel,
  command: typeof Command.Type,
  sealed: string
): CellModel => {
  if (command.kind === "erase") {
    return { erased: true, marked: model.marked, sealed: undefined };
  }

  if (model.erased || (model.marked && !command.erase)) {
    return model;
  }

  return { erased: false, marked: model.marked || command.erase, sealed };
};

it.effect.prop(
  "once a contact is marked for erase, only another erase save or the erase itself changes it",
  { commands: Arbitrary.schema(Schema.Array(Command)) },
  ({ commands }) =>
    Effect.gen(function* stickyErase() {
      const cell = joinContactCell(yield* memoryStorage);

      let model: CellModel = {
        erased: false,
        marked: false,
        sealed: undefined,
      };

      for (const [index, command] of commands.entries()) {
        const sealed = `sealed-${index}`;

        yield* command.kind === "erase"
          ? cell.joinErase()
          : cell.joinSave(sealed, command.erase);

        model = step(model, command, sealed);

        expect(yield* cell.joinRead()).toBe(model.sealed);
      }
    })
);

it.effect(
  "a delivery result read before an erase cannot overwrite the erase marker",
  () =>
    Effect.gen(function* setStateRace() {
      const cell = joinContactCell(yield* memoryStorage);

      const interleave = yield* Ref.make(Option.none<Effect.Effect<void>>());

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(
          joinContactStoreLayer(() => ({
            ...cell,
            joinRead: () =>
              cell
                .joinRead()
                .pipe(
                  Effect.tap(() =>
                    Ref.getAndSet(interleave, Option.none()).pipe(
                      Effect.flatMap((pending) =>
                        Option.getOrElse(pending, () => Effect.void)
                      )
                    )
                  )
                ),
          })).pipe(
            Layer.provide(
              InterestTokens.layer(Redacted.make("synthetic-secret"))
            )
          )
        )
      );

      const contact = {
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef:
          yield* Schema.decodeEffect(ContactRefSchema)("synthetic-contact"),
        email: "synthetic@example.test",
        hold: false,
        score: 0,
        signals: [],
        state: "ready" as const,
        submissionId: "synthetic-submission",
        ticket: "synthetic-ticket",
      };

      yield* contacts.save(withPending(contact, "delivery"));

      yield* Ref.set(
        interleave,
        Option.some(contacts.save(withPending(contact, "erase")))
      );

      yield* contacts.setState(contact.submissionId, "accepted");

      const after = yield* contacts.read(contact.submissionId);

      expect(after?.pending).toBe("erase");
    })
);
