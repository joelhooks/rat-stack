import { IntakeEvents } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import {
  JoinContactSchema,
  JoinContactStore,
} from "@rat-stack/core/join-interest";
import type {
  JoinContact,
  JoinContactState,
} from "@rat-stack/core/join-interest";
import { Effect, Layer, Schema } from "effect";

export interface JoinContactStub {
  readonly joinSave: (sealed: string) => Effect.Effect<void>;
  readonly joinRead: () => Effect.Effect<string | undefined>;
  readonly joinErase: () => Effect.Effect<void>;
}

const SealedContact = Schema.Struct({
  data: Schema.String,
  iv: Schema.String,
});

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const base64 = (bytes: Uint8Array) => btoa(String.fromCodePoint(...bytes));

const bytesOf = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);

export const joinContactStoreLayer = (
  stub: (submissionId: string) => JoinContactStub,
  note: (submissionId: string) => Effect.Effect<void> = () => Effect.void
) =>
  Layer.effect(
    JoinContactStore,
    Effect.gen(function* makeContactStore() {
      const tokens = yield* InterestTokens;
      const events = yield* IntakeEvents;

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
          JSON.stringify({ data: base64(new Uint8Array(data)), iv: base64(iv) })
        );
      });

      const read = Effect.fn("JoinContactStore.read")(function* read(
        submissionId: string
      ) {
        const sealed = yield* stub(submissionId).joinRead();

        if (sealed === undefined) {
          return sealed;
        }

        const envelope = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(SealedContact)
        )(sealed).pipe(Effect.orDie);

        const key = yield* keyFor(submissionId);

        const plaintext = yield* Effect.promise(
          // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise boundary.
          () =>
            crypto.subtle.decrypt(
              {
                additionalData: encoder.encode(submissionId),
                iv: bytesOf(envelope.iv),
                name: "AES-GCM",
              },
              key,
              bytesOf(envelope.data)
            )
        );

        return yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(JoinContactSchema)
        )(decoder.decode(plaintext)).pipe(Effect.orDie);
      });

      return {
        erase: Effect.fn("JoinContactStore.erase")(function* erase(
          submissionId: string
        ) {
          const contact = yield* read(submissionId);
          yield* stub(submissionId).joinErase();

          if (contact !== undefined) {
            yield* events.erase(contact.contactRef);
          }
        }),
        read,
        save,
        setState: Effect.fn("JoinContactStore.setState")(function* setState(
          submissionId: string,
          state: JoinContactState
        ) {
          const contact = yield* read(submissionId);

          if (contact !== undefined) {
            yield* save({ ...contact, state });
          }
        }),
      };
    })
  );
