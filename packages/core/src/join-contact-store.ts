import { Context, DateTime, Effect, Layer, Ref, Schema } from "effect";

import { ContactRefSchema } from "./intake-events.js";
import type { JoinContactUnreadable } from "./join-contact-unreadable.js";

export { JoinContactUnreadable } from "./join-contact-unreadable.js";

export const JOIN_CONTACT_RETENTION_MILLIS = 24 * 60 * 60 * 1000;

export const JoinContactSchema = Schema.Struct({
  agentRef: Schema.String,
  clientBucket: Schema.Struct({ ipHash: Schema.String, uaHash: Schema.String }),
  contactRef: ContactRefSchema,
  email: Schema.String,
  hold: Schema.Boolean,
  pending: Schema.optionalKey(Schema.Literals(["delivery", "erase"])),
  retentionDeadlineAt: Schema.optionalKey(Schema.Finite),
  retryAt: Schema.optionalKey(Schema.Finite),
  score: Schema.Finite,
  signals: Schema.Array(Schema.String),
  state: Schema.Literals(["held", "ready", "accepted", "refused"]),
  submissionId: Schema.String,
  ticket: Schema.String,
});

export const JoinErasureSchema = Schema.Struct({
  contactRef: ContactRefSchema,
  handedToDrovr: Schema.Boolean.annotate({
    description:
      "A delivery attempt left for drovr, so drovr may hold this contact; forward the erasure.",
  }),
  handedToDrovrAt: Schema.NullOr(Schema.String).annotate({
    description:
      "ISO time of the first dispatch intent, or null when the legacy dispatch time is unknown.",
  }),
  pending: Schema.Literal("erase"),
});

export type JoinErasure = typeof JoinErasureSchema.Type;

export type JoinRetentionGroup =
  | "current"
  | "gone"
  | "finished"
  | "erase"
  | "pending"
  | "unreadable";

export type JoinContact = typeof JoinContactSchema.Type;

export type JoinContactState = JoinContact["state"];

export type JoinContactPending = NonNullable<JoinContact["pending"]>;

export const withState = (
  contact: JoinContact,
  state: JoinContactState
): JoinContact => {
  const { pending, ...settled } = contact;

  return pending === "erase" || (pending === "delivery" && state === "ready")
    ? { ...settled, pending, state }
    : { ...settled, state };
};

export const withPending = (
  contact: JoinContact,
  pending: JoinContactPending
): JoinContact =>
  contact.pending === "erase" ? contact : { ...contact, pending };

export class JoinContactStore extends Context.Service<
  JoinContactStore,
  {
    readonly save: (contact: JoinContact) => Effect.Effect<void>;
    readonly read: (
      submissionId: string
    ) => Effect.Effect<JoinContact | undefined, JoinContactUnreadable>;
    readonly setState: (
      submissionId: string,
      state: JoinContactState
    ) => Effect.Effect<void, JoinContactUnreadable>;
    readonly erase: (submissionId: string) => Effect.Effect<void>;
    readonly requestErase: (
      submissionId: string
    ) => Effect.Effect<JoinErasure | undefined>;
    readonly readHandoff: (
      submissionId: string
    ) => Effect.Effect<JoinErasure | undefined>;
    readonly readErasure: (
      submissionId: string
    ) => Effect.Effect<JoinErasure | undefined>;
    readonly completeErasure: (submissionId: string) => Effect.Effect<void>;
    readonly migrateRetention: (
      submissionId: string,
      dryRun: boolean
    ) => Effect.Effect<JoinRetentionGroup>;
    readonly markHandedToDrovr: (submissionId: string) => Effect.Effect<void>;
  }
>()("@rat-stack/core/JoinContactStore") {
  static readonly testLayer = Layer.effect(
    this,
    Effect.gen(function* makeTestContacts() {
      const contacts = yield* Ref.make<ReadonlyMap<string, JoinContact>>(
        new Map()
      );

      const erased = yield* Ref.make<ReadonlySet<string>>(new Set());

      const metadata = yield* Ref.make<ReadonlyMap<string, JoinErasure>>(
        new Map()
      );

      const erasures = yield* Ref.make<ReadonlySet<string>>(new Set());

      const erase = (submissionId: string) =>
        Effect.andThen(
          Ref.update(erased, (all) => new Set(all).add(submissionId)),
          Ref.update(contacts, (all) => {
            const next = new Map(all);
            next.delete(submissionId);

            return next;
          })
        );

      const requestErase = (submissionId: string) =>
        Ref.get(metadata).pipe(
          Effect.flatMap((all) => {
            const marker = all.get(submissionId);

            return marker === undefined
              ? Effect.undefined
              : Ref.update(erasures, (pending) =>
                  new Set(pending).add(submissionId)
                ).pipe(Effect.as(marker));
          }),
          Effect.tap(() => erase(submissionId))
        );

      return {
        migrateRetention: (submissionId: string) =>
          Ref.get(contacts).pipe(
            Effect.map((all): JoinRetentionGroup =>
              all.has(submissionId) ? "current" : "gone"
            )
          ),
        requestErase,
        readHandoff: (submissionId: string) =>
          Ref.get(metadata).pipe(Effect.map((all) => all.get(submissionId))),
        readErasure: (submissionId: string) =>
          Ref.get(erasures).pipe(
            Effect.flatMap((pending) =>
              pending.has(submissionId)
                ? Ref.get(metadata).pipe(
                    Effect.map((all) => all.get(submissionId))
                  )
                : Effect.undefined
            )
          ),
        completeErasure: (submissionId: string) =>
          Ref.update(erasures, (pending) => {
            const next = new Set(pending);
            next.delete(submissionId);

            return next;
          }),
        markHandedToDrovr: (submissionId: string) =>
          DateTime.now.pipe(
            Effect.flatMap((now) =>
              Ref.update(metadata, (all) => {
                const marker = all.get(submissionId);

                return marker === undefined
                  ? all
                  : new Map(all).set(submissionId, {
                      ...marker,
                      handedToDrovr: true,
                      handedToDrovrAt: marker.handedToDrovr
                        ? marker.handedToDrovrAt
                        : DateTime.formatIso(now),
                    });
              })
            )
          ),
        erase,
        read: (submissionId: string) =>
          Ref.get(contacts).pipe(Effect.map((all) => all.get(submissionId))),
        save: (contact: JoinContact) =>
          Ref.update(metadata, (all) =>
            all.has(contact.submissionId)
              ? all
              : new Map(all).set(contact.submissionId, {
                  contactRef: contact.contactRef,
                  handedToDrovr: false,
                  handedToDrovrAt: null,
                  pending: "erase",
                })
          ).pipe(
            Effect.andThen(
              contact.pending === "erase"
                ? requestErase(contact.submissionId)
                : Effect.void
            ),
            Effect.andThen(
              Effect.flatMap(Ref.get(erased), (gone) =>
                gone.has(contact.submissionId)
                  ? Effect.void
                  : Ref.update(contacts, (all) =>
                      new Map(all).set(contact.submissionId, contact)
                    )
              )
            )
          ),
        setState: (submissionId: string, state: JoinContactState) =>
          Ref.update(contacts, (all) => {
            const contact = all.get(submissionId);

            return contact === undefined
              ? all
              : new Map(all).set(submissionId, withState(contact, state));
          }),
      };
    })
  );
}
