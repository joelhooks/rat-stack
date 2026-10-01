import type { ContactRef } from "@rat-stack/core/intake";
import { Context, Effect, Layer, Ref } from "effect";

export interface SealedRow {
  readonly id: string;
  readonly sealed: string;
}

export interface IntakeVaultStub {
  readonly intakeErase: () => Effect.Effect<void>;
  readonly intakeKey: (candidate: string) => Effect.Effect<string>;
  readonly intakeStore: (rows: readonly SealedRow[]) => Effect.Effect<void>;
}

export class IntakeVault extends Context.Service<
  IntakeVault,
  {
    readonly erase: (actor: ContactRef) => Effect.Effect<void>;
    readonly key: (
      actor: ContactRef,
      candidate: string
    ) => Effect.Effect<string>;
    readonly store: (
      actor: ContactRef,
      rows: readonly SealedRow[]
    ) => Effect.Effect<void>;
  }
>()("@rat-stack/intake-live/IntakeVault") {}

export const doIntakeVault = (stub: (actor: ContactRef) => IntakeVaultStub) =>
  Layer.succeed(IntakeVault, {
    erase: (actor) => stub(actor).intakeErase(),
    key: (actor, candidate) => stub(actor).intakeKey(candidate),
    store: (actor, rows) => stub(actor).intakeStore(rows),
  });

interface HeldContact {
  readonly key: string;
  readonly rows: ReadonlyMap<string, string>;
}

export const makeMemoryIntakeVault = Effect.gen(
  function* makeMemoryIntakeVault() {
    const held = yield* Ref.make(new Map<ContactRef, HeldContact>());

    const layer = Layer.succeed(IntakeVault, {
      erase: (actor) =>
        Ref.update(held, (contacts) => {
          const next = new Map(contacts);
          next.delete(actor);

          return next;
        }),
      key: (actor, candidate) =>
        Ref.modify(held, (contacts): [string, Map<ContactRef, HeldContact>] => {
          const existing = contacts.get(actor);

          if (existing !== undefined) {
            return [existing.key, contacts];
          }

          return [
            candidate,
            new Map(contacts).set(actor, { key: candidate, rows: new Map() }),
          ];
        }),
      store: (actor, rows) =>
        Ref.update(held, (contacts) => {
          const existing = contacts.get(actor);

          if (existing === undefined) {
            return contacts;
          }

          const stored = new Map(existing.rows);

          for (const row of rows) {
            if (!stored.has(row.id)) {
              stored.set(row.id, row.sealed);
            }
          }

          return new Map(contacts).set(actor, { ...existing, rows: stored });
        }),
    });

    return { contents: Ref.get(held), layer } as const;
  }
);
