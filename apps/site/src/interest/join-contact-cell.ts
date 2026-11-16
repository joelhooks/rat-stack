import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinErasureSchema,
} from "@rat-stack/core/join-interest";
import { Clock, DateTime, Effect, Option, Schema } from "effect";

export const JOIN_CONTACT_KEY = "join-contact";

export const JOIN_ERASED_KEY = "join-erased";

const StoredContact = Schema.Struct({
  erase: Schema.Boolean,
  retentionDeadlineAt: Schema.optionalKey(Schema.Finite),
  sealed: Schema.String,
});

const CONTACT_META_KEY = "join-contact-meta";

const ERASE_REQUEST_KEY = "join-erase-request";

export type JoinCellValue =
  | boolean
  | typeof StoredContact.Type
  | typeof JoinErasureSchema.Type;

export interface JoinCellStorage {
  readonly get: (key: string) => Effect.Effect<unknown>;
  readonly put: (key: string, value: JoinCellValue) => Effect.Effect<void>;
  readonly delete: (key: string) => Effect.Effect<unknown>;
  readonly setAlarm: (deadlineAt: number) => Effect.Effect<void>;
}

const decodeStored = Schema.decodeUnknownOption(StoredContact);

const decodeLegacy = Schema.decodeUnknownOption(Schema.String);

export const joinContactCell = (storage: JoinCellStorage) => {
  const current = storage.get(JOIN_CONTACT_KEY).pipe(
    Effect.map((value) =>
      Option.orElse(decodeStored(value), () =>
        Option.orElse(
          Option.map(decodeLegacy(value), (sealed) => ({
            erase: false,
            retentionDeadlineAt: undefined,
            sealed,
          })),
          () =>
            value === undefined
              ? Option.none()
              : Option.some({
                  erase: false,
                  retentionDeadlineAt: undefined,
                  sealed: "",
                })
        )
      )
    )
  );

  const metadata = storage
    .get(CONTACT_META_KEY)
    .pipe(Effect.map(Schema.decodeUnknownOption(JoinErasureSchema)));

  const readErasure = () =>
    storage
      .get(ERASE_REQUEST_KEY)
      .pipe(
        Effect.map(Schema.decodeUnknownOption(JoinErasureSchema)),
        Effect.map(Option.getOrUndefined)
      );

  const joinErase = () =>
    storage
      .put(JOIN_ERASED_KEY, true)
      .pipe(Effect.andThen(storage.delete(JOIN_CONTACT_KEY)), Effect.asVoid);

  const expire = Effect.gen(function* expireContact() {
    yield* joinErase();
    yield* Effect.logWarning("join contact erased at retention deadline");
  });

  const readLive = Effect.gen(function* readLiveContact() {
    const contact = yield* current;

    if (Option.isNone(contact)) {
      return contact;
    }

    const now = yield* Clock.currentTimeMillis;
    const { retentionDeadlineAt } = contact.value;

    if (retentionDeadlineAt !== undefined && now >= retentionDeadlineAt) {
      yield* expire;

      return Option.none();
    }

    return contact;
  });

  return {
    alarm: () =>
      readLive.pipe(
        Effect.flatMap((contact) =>
          Option.isSome(contact) &&
          contact.value.retentionDeadlineAt !== undefined
            ? storage.setAlarm(contact.value.retentionDeadlineAt)
            : Effect.void
        )
      ),
    joinErase,
    joinReadSnapshot: () =>
      readLive.pipe(
        Effect.map(
          Option.map(({ sealed, retentionDeadlineAt }) =>
            retentionDeadlineAt === undefined
              ? { sealed }
              : { sealed, retentionDeadlineAt }
          )
        ),
        Effect.map(Option.getOrUndefined)
      ),
    joinReadRetentionDeadline: () =>
      current.pipe(
        Effect.map(
          Option.flatMap((contact) =>
            Option.fromUndefinedOr(contact.retentionDeadlineAt)
          )
        ),
        Effect.map(Option.getOrUndefined)
      ),
    joinReadErasure: readErasure,
    joinReadHandoff: () => metadata.pipe(Effect.map(Option.getOrUndefined)),
    joinRequestErase: () =>
      Effect.gen(function* requestErase() {
        const marker = yield* metadata;

        if (Option.isSome(marker)) {
          yield* storage.put(ERASE_REQUEST_KEY, marker.value);
        }

        yield* joinErase();

        return Option.getOrUndefined(marker);
      }),
    joinCompleteErasure: () =>
      storage.delete(ERASE_REQUEST_KEY).pipe(Effect.asVoid),
    joinMarkHandedToDrovr: (legacy = false) =>
      Effect.gen(function* markHandedToDrovr() {
        const marker = yield* metadata;

        if (Option.isNone(marker)) {
          return yield* Effect.die(
            new Error(
              "Join contact handoff metadata is missing. Erasure forwarding needs a durable contact reference. Fix: call `joinRetentionBackfill` before retrying delivery."
            )
          );
        }

        const handedToDrovrAt =
          legacy || marker.value.handedToDrovr
            ? marker.value.handedToDrovrAt
            : DateTime.formatIso(yield* DateTime.now);

        const handed = {
          ...marker.value,
          handedToDrovr: true,
          handedToDrovrAt,
        };

        yield* storage.put(CONTACT_META_KEY, handed);

        if ((yield* readErasure()) !== undefined) {
          yield* storage.put(ERASE_REQUEST_KEY, handed);
        }

        return yield* Effect.void;
      }),
    joinRead: () =>
      readLive.pipe(
        Effect.map(Option.map(({ sealed }) => sealed)),
        Effect.map(Option.getOrUndefined)
      ),
    joinSave: (
      sealed: string,
      erase: boolean,
      deadlineAt?: number,
      contactRef?: string
    ) =>
      Effect.gen(function* saveUnlessErased() {
        if (contactRef !== undefined && Option.isNone(yield* metadata)) {
          const marker = yield* Schema.decodeEffect(JoinErasureSchema)({
            contactRef,
            handedToDrovr: false,
            handedToDrovrAt: null,
            pending: "erase",
          }).pipe(Effect.orDie);

          yield* storage.put(CONTACT_META_KEY, marker);
        }

        if (erase) {
          const marker = yield* metadata;

          if (Option.isSome(marker)) {
            yield* storage.put(ERASE_REQUEST_KEY, marker.value);
          }
        }

        const erased = yield* storage.get(JOIN_ERASED_KEY);

        if (erased === true) {
          return;
        }

        const held = yield* current;

        if (Option.isSome(held) && held.value.erase && !erase) {
          return;
        }

        const now = yield* Clock.currentTimeMillis;

        const retentionDeadlineAt = Math.min(
          Option.isSome(held)
            ? (held.value.retentionDeadlineAt ??
                now + JOIN_CONTACT_RETENTION_MILLIS)
            : now + JOIN_CONTACT_RETENTION_MILLIS,
          deadlineAt ?? now + JOIN_CONTACT_RETENTION_MILLIS
        );

        if (now >= retentionDeadlineAt) {
          yield* expire;

          return;
        }

        yield* storage.setAlarm(retentionDeadlineAt);
        yield* storage.put(JOIN_CONTACT_KEY, {
          erase,
          retentionDeadlineAt,
          sealed,
        });
      }),
  };
};
