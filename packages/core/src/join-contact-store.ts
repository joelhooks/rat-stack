import { Context, Effect, Layer, Ref, Schema } from "effect";

import { ContactRefSchema } from "./intake-events.js";

export const JoinContactSchema = Schema.Struct({
  agentRef: Schema.String,
  clientBucket: Schema.Struct({ ipHash: Schema.String, uaHash: Schema.String }),
  contactRef: ContactRefSchema,
  email: Schema.String,
  hold: Schema.Boolean,
  pending: Schema.optionalKey(Schema.Literals(["delivery", "erase"])),
  score: Schema.Finite,
  signals: Schema.Array(Schema.String),
  state: Schema.Literals(["held", "ready", "accepted", "refused"]),
  submissionId: Schema.String,
  ticket: Schema.String,
});

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
    ) => Effect.Effect<JoinContact | undefined>;
    readonly setState: (
      submissionId: string,
      state: JoinContactState
    ) => Effect.Effect<void>;
    readonly erase: (submissionId: string) => Effect.Effect<void>;
  }
>()("@rat-stack/core/JoinContactStore") {
  static readonly testLayer = Layer.effect(
    this,
    Effect.gen(function* makeTestContacts() {
      const contacts = yield* Ref.make<ReadonlyMap<string, JoinContact>>(
        new Map()
      );

      const erased = yield* Ref.make<ReadonlySet<string>>(new Set());

      return {
        erase: (submissionId: string) =>
          Effect.andThen(
            Ref.update(erased, (all) => new Set(all).add(submissionId)),
            Ref.update(contacts, (all) => {
              const next = new Map(all);
              next.delete(submissionId);

              return next;
            })
          ),
        read: (submissionId: string) =>
          Ref.get(contacts).pipe(Effect.map((all) => all.get(submissionId))),
        save: (contact: JoinContact) =>
          Effect.flatMap(Ref.get(erased), (gone) =>
            gone.has(contact.submissionId)
              ? Effect.void
              : Ref.update(contacts, (all) =>
                  new Map(all).set(contact.submissionId, contact)
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
