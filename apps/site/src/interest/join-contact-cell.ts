import { Effect, Option, Schema } from "effect";

export const JOIN_CONTACT_KEY = "join-contact";

export const JOIN_ERASED_KEY = "join-erased";

const StoredContact = Schema.Struct({
  erase: Schema.Boolean,
  sealed: Schema.String,
});

export type JoinCellValue = boolean | typeof StoredContact.Type;

export interface JoinCellStorage {
  readonly get: (key: string) => Effect.Effect<unknown>;
  readonly put: (key: string, value: JoinCellValue) => Effect.Effect<void>;
  readonly delete: (key: string) => Effect.Effect<unknown>;
}

const decodeStored = Schema.decodeUnknownOption(StoredContact);

const decodeLegacy = Schema.decodeUnknownOption(Schema.String);

export const joinContactCell = (storage: JoinCellStorage) => {
  const current = storage.get(JOIN_CONTACT_KEY).pipe(
    Effect.map((value) =>
      Option.orElse(decodeStored(value), () =>
        Option.map(decodeLegacy(value), (sealed) => ({
          erase: false,
          sealed,
        }))
      )
    )
  );

  return {
    joinErase: () =>
      storage
        .put(JOIN_ERASED_KEY, true)
        .pipe(Effect.andThen(storage.delete(JOIN_CONTACT_KEY)), Effect.asVoid),
    joinRead: () =>
      current.pipe(
        Effect.map(Option.map(({ sealed }) => sealed)),
        Effect.map(Option.getOrUndefined)
      ),
    joinSave: (sealed: string, erase: boolean) =>
      Effect.gen(function* saveUnlessErased() {
        const erased = yield* storage.get(JOIN_ERASED_KEY);

        if (erased === true) {
          return;
        }

        const eraseMarked = (yield* current).pipe(
          Option.exists((contact) => contact.erase)
        );

        if (eraseMarked && !erase) {
          return;
        }

        yield* storage.put(JOIN_CONTACT_KEY, { erase, sealed });
      }),
  };
};
