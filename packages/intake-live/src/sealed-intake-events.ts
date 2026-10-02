import {
  ContactRefSchema,
  IntakeEvents,
  IntakeEventsUnavailable,
  IntakeObjectSchema,
  IntakeVerbSchema,
} from "@rat-stack/core/intake";
import type { ContactRef, IntakeStatement } from "@rat-stack/core/intake";
import { Effect, Layer, Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";

import { IntakeVault } from "./intake-vault.js";

const IV_BYTES = 12;

export const SealedStatementSchema = Schema.Struct({
  actor: ContactRefSchema,
  id: Schema.String,
  object: IntakeObjectSchema,
  sealedResult: Schema.optionalKey(Schema.String),
  submissionId: Schema.String,
  timestamp: Schema.String,
  v: Schema.Literal(1),
  verb: IntakeVerbSchema,
});

export type SealedStatement = typeof SealedStatementSchema.Type;

const encodeSealedStatement = Schema.encodeEffect(
  Schema.fromJsonString(SealedStatementSchema)
);

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

const decodeJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Json)
);

type ContactKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const importContactKey = (encodedKey: string) =>
  Effect.promise(
    // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
    () =>
      crypto.subtle.importKey(
        "raw",
        Result.getOrThrow(Base64Url.decode(encodedKey)),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
      )
  );

const randomContactKey = Effect.sync(() =>
  Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))
);

const seal = (key: ContactKey, plaintext: string) =>
  Effect.gen(function* sealText() {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

    const cipher = yield* Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
      () =>
        crypto.subtle.encrypt(
          { iv, name: "AES-GCM" },
          key,
          new TextEncoder().encode(plaintext)
        )
    );

    const sealed = new Uint8Array(IV_BYTES + cipher.byteLength);
    sealed.set(iv);
    sealed.set(new Uint8Array(cipher), IV_BYTES);

    return Base64Url.encode(sealed);
  });

export const unsealResult = (encodedKey: string, sealedResult: string) =>
  Effect.gen(function* unseal() {
    const key = yield* importContactKey(encodedKey);
    const sealed = Result.getOrThrow(Base64Url.decode(sealedResult));

    const plain = yield* Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
      () =>
        crypto.subtle.decrypt(
          { iv: sealed.slice(0, IV_BYTES), name: "AES-GCM" },
          key,
          sealed.slice(IV_BYTES)
        )
    );

    return yield* decodeJson(new TextDecoder().decode(plain));
  });

const byActor = (statements: readonly IntakeStatement[]) => {
  const grouped = new Map<ContactRef, IntakeStatement[]>();

  for (const statement of statements) {
    grouped.set(statement.actor, [
      ...(grouped.get(statement.actor) ?? []),
      statement,
    ]);
  }

  return grouped;
};

export const sealedIntakeEventsLayer = Layer.effect(
  IntakeEvents,
  Effect.gen(function* makeSealedIntakeEvents() {
    const vault = yield* IntakeVault;

    const sealStatement = (key: ContactKey, statement: IntakeStatement) =>
      Effect.gen(function* sealOne() {
        const sealedResult =
          statement.result === undefined
            ? undefined
            : yield* seal(key, yield* encodeJson(statement.result));

        const plain = {
          actor: statement.actor,
          id: statement.id,
          object: statement.object,
          submissionId: statement.context.submissionId,
          timestamp: statement.timestamp,
          v: 1,
          verb: statement.verb,
        } as const;

        const row: SealedStatement =
          sealedResult === undefined ? plain : { ...plain, sealedResult };

        return { id: statement.id, sealed: yield* encodeSealedStatement(row) };
      });

    const recordContact = (
      actor: ContactRef,
      statements: readonly IntakeStatement[]
    ) =>
      Effect.gen(function* recordForContact() {
        const encodedKey = yield* vault.key(actor, yield* randomContactKey);
        const key = yield* importContactKey(encodedKey);

        // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach is the Effect combinator, not Array#forEach with a thisArg.
        const rows = yield* Effect.forEach(statements, (statement) =>
          sealStatement(key, statement)
        );

        yield* vault.store(actor, rows);
      });

    return {
      erase: (actor: ContactRef) => vault.erase(actor),
      record: (statements: readonly IntakeStatement[]) =>
        Effect.forEach(byActor(statements), ([actor, grouped]) =>
          recordContact(actor, grouped)
        ).pipe(
          Effect.asVoid,
          Effect.catchCause(() => Effect.fail(new IntakeEventsUnavailable({})))
        ),
    };
  })
);
