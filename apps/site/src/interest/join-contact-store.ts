import { InterestTokens } from "@rat-stack/core/interest";
import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactSchema,
  JoinContactStore,
  withState,
  withPending,
} from "@rat-stack/core/join-interest";
import type {
  JoinContact,
  JoinContactState,
  JoinErasure,
  JoinRetentionGroup,
} from "@rat-stack/core/join-interest";
import { Clock, Effect, Layer, Option, Schema } from "effect";

export interface JoinContactStub {
  readonly joinSave: (
    sealed: string,
    erase: boolean,
    retentionDeadlineAt?: number,
    contactRef?: string
  ) => Effect.Effect<void>;
  readonly joinRead: () => Effect.Effect<string | undefined>;
  readonly joinErase: () => Effect.Effect<void>;
  readonly joinRequestErase: () => Effect.Effect<JoinErasure | undefined>;
  readonly joinReadErasure: () => Effect.Effect<JoinErasure | undefined>;
  readonly joinCompleteErasure: () => Effect.Effect<void>;
  readonly joinReadHandoff: () => Effect.Effect<JoinErasure | undefined>;
  readonly joinMarkHandedToDrovr: (legacy?: boolean) => Effect.Effect<void>;
}

const SealedContact = Schema.Struct({
  data: Schema.String,
  iv: Schema.String,
});

class JoinContactUnreadable extends Schema.TaggedError<JoinContactUnreadable>()(
  "JoinContactUnreadable",
  {
    cause: Schema.Defect(),
  }
) {}

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const base64 = (bytes: Uint8Array) => btoa(String.fromCodePoint(...bytes));

const bytesOf = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);

const retentionGroupFor = (contact: JoinContact): JoinRetentionGroup => {
  if (contact.pending === "erase") {
    return "erase";
  }

  if (
    contact.state === "accepted" ||
    contact.state === "refused" ||
    (contact.state === "held" && contact.retentionDeadlineAt === undefined)
  ) {
    return "finished";
  }

  return contact.retentionDeadlineAt === undefined ? "pending" : "current";
};

export const joinContactStoreLayer = (
  stub: (submissionId: string) => JoinContactStub,
  note: (submissionId: string) => Effect.Effect<void> = () => Effect.void,
  markPending: (
    submissionId: string,
    pending: boolean
  ) => Effect.Effect<void> = () => Effect.void
) =>
  Layer.effect(
    JoinContactStore,
    Effect.gen(function* makeContactStore() {
      const tokens = yield* InterestTokens;

      const keyFor = Effect.fn("JoinContactStore.keyFor")(function* keyFor(
        submissionId: string
      ) {
        const digest = yield* tokens.digest("agent-contact-key", submissionId);

        const bytes = Uint8Array.from(digest.match(/.{2}/gu) ?? [], (byte) =>
          Number.parseInt(byte, 16)
        );

        return yield* Effect.promise(
          crypto.subtle.importKey.bind(
            crypto.subtle,
            "raw",
            bytes,
            "AES-GCM",
            false,
            ["encrypt", "decrypt"]
          )
        );
      });

      const save = Effect.fn("JoinContactStore.save")(function* save(
        contact: JoinContact
      ) {
        const key = yield* keyFor(contact.submissionId);

        const iv = yield* Effect.sync(() =>
          crypto.getRandomValues(new Uint8Array(12))
        );

        const data = yield* Effect.promise(
          crypto.subtle.encrypt.bind(
            crypto.subtle,
            {
              additionalData: encoder.encode(contact.submissionId),
              iv,
              name: "AES-GCM",
            },
            key,
            encoder.encode(JSON.stringify(contact))
          )
        );

        yield* note(contact.submissionId);
        yield* stub(contact.submissionId).joinSave(
          JSON.stringify({
            data: base64(new Uint8Array(data)),
            iv: base64(iv),
          }),
          contact.pending === "erase",
          contact.retentionDeadlineAt,
          contact.contactRef
        );
        yield* markPending(
          contact.submissionId,
          contact.pending !== undefined ||
            (yield* stub(contact.submissionId).joinReadErasure()) !== undefined
        );
      });

      const load = Effect.fn("JoinContactStore.load")(function* load(
        submissionId: string
      ) {
        const sealed = yield* stub(submissionId).joinRead();

        if (sealed === undefined) {
          return sealed;
        }

        const envelope = yield* Schema.decodeEffect(
          Schema.fromJsonString(SealedContact)
        )(sealed).pipe(
          Effect.mapError((cause) => new JoinContactUnreadable({ cause }))
        );

        const key = yield* keyFor(submissionId);

        const plaintext = yield* Effect.tryPromise({
          try: () =>
            crypto.subtle.decrypt(
              {
                additionalData: encoder.encode(submissionId),
                iv: bytesOf(envelope.iv),
                name: "AES-GCM",
              },
              key,
              bytesOf(envelope.data)
            ),
          catch: (cause) => new JoinContactUnreadable({ cause }),
        });

        return yield* Schema.decodeEffect(
          Schema.fromJsonString(JoinContactSchema)
        )(decoder.decode(plaintext)).pipe(
          Effect.mapError((cause) => new JoinContactUnreadable({ cause }))
        );
      });

      const migrateRetention = Effect.fn("JoinContactStore.migrateRetention")(
        function* migrateRetention(
          submissionId: string,
          dryRun: boolean
        ): Effect.fn.Return<JoinRetentionGroup> {
          const loaded = yield* load(submissionId).pipe(
            Effect.map(Option.some),
            Effect.catchTag("JoinContactUnreadable", () =>
              Effect.succeed(Option.none())
            )
          );

          if (Option.isNone(loaded)) {
            return "unreadable";
          }

          const contact = loaded.value;

          if (contact === undefined) {
            return "gone";
          }

          const group = retentionGroupFor(contact);

          if (dryRun || group === "current") {
            return group;
          }

          const retentionDeadlineAt =
            (yield* Clock.currentTimeMillis) + JOIN_CONTACT_RETENTION_MILLIS;

          const migrated = { ...contact, retentionDeadlineAt };
          yield* save(
            group === "pending"
              ? withPending(withState(migrated, "ready"), "delivery")
              : migrated
          );

          yield* stub(submissionId).joinMarkHandedToDrovr(true);

          if (group === "erase") {
            yield* stub(submissionId).joinRequestErase();
            yield* markPending(submissionId, true);
          }

          if (group !== "pending") {
            yield* stub(submissionId).joinErase();
          }

          return group;
        }
      );

      const read = (submissionId: string) =>
        migrateRetention(submissionId, false).pipe(
          Effect.flatMap((group) =>
            group === "current" || group === "pending" || group === "unreadable"
              ? load(submissionId).pipe(Effect.orDie)
              : Effect.undefined
          )
        );

      return {
        migrateRetention,
        erase: (submissionId: string) =>
          Effect.gen(function* eraseContact() {
            yield* stub(submissionId).joinErase();
            yield* markPending(
              submissionId,
              (yield* stub(submissionId).joinReadErasure()) !== undefined
            );
          }),
        requestErase: (submissionId: string) =>
          Effect.gen(function* requestErase() {
            const contact = yield* read(submissionId);

            if (contact !== undefined) {
              yield* save(contact);
            }

            const marker = yield* stub(submissionId).joinRequestErase();

            if (marker !== undefined) {
              yield* markPending(submissionId, true);
            }

            return marker;
          }),
        readHandoff: (submissionId: string) =>
          stub(submissionId).joinReadHandoff(),
        readErasure: (submissionId: string) =>
          stub(submissionId).joinReadErasure(),
        completeErasure: (submissionId: string) =>
          stub(submissionId)
            .joinCompleteErasure()
            .pipe(Effect.andThen(markPending(submissionId, false))),
        markHandedToDrovr: (submissionId: string) =>
          stub(submissionId).joinMarkHandedToDrovr(),
        read,
        save,
        setState: Effect.fn("JoinContactStore.setState")(function* setState(
          submissionId: string,
          state: JoinContactState
        ) {
          const contact = yield* read(submissionId);

          if (contact !== undefined) {
            yield* save(withState(contact, state));
          }
        }),
      };
    })
  );
