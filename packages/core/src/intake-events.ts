import { Context, Effect, Layer, Ref, Schema } from "effect";

import { IntakeEventsTest } from "./intake-events-test.js";
import { IntakeEventsUnavailable } from "./intake-events-unavailable.js";
import { ConsentIdSchema, QuestionIdSchema } from "./intake-questions.js";

export const ContactRefSchema = Schema.String.check(Schema.isNonEmpty()).pipe(
  Schema.brand("ContactRef")
);

export type ContactRef = typeof ContactRefSchema.Type;

export const IntakeVerbSchema = Schema.Literals([
  "started",
  "answered",
  "consented",
  "submitted",
  "confirmed",
]);

export type IntakeVerb = typeof IntakeVerbSchema.Type;

export const IntakeObjectSchema = Schema.Union([
  Schema.Literal("tokenmaxx/intake"),
  Schema.TemplateLiteral(["tokenmaxx/questions/", QuestionIdSchema]),
  Schema.TemplateLiteral(["tokenmaxx/consents/", ConsentIdSchema]),
]);

export type IntakeObject = typeof IntakeObjectSchema.Type;

export const IntakeStatementSchema = Schema.Struct({
  actor: ContactRefSchema,
  context: Schema.Struct({
    intake: Schema.Literal("tokenmaxx"),
    submissionId: Schema.String,
  }),
  id: Schema.String.check(Schema.isUUID(7)),
  object: IntakeObjectSchema,
  result: Schema.optionalKey(Schema.Json),
  timestamp: Schema.String,
  verb: IntakeVerbSchema,
});

export type IntakeStatement = typeof IntakeStatementSchema.Type;

export const IntakeContactSchema = Schema.Struct({
  agentRef: Schema.String,
  email: Schema.String,
  name: Schema.optionalKey(Schema.String),
  x: Schema.optionalKey(Schema.String),
});

export type IntakeContact = typeof IntakeContactSchema.Type;

export interface RecordedContact extends IntakeContact {
  readonly actor: ContactRef;
  readonly submissionId: string;
}

export const xapiVerbIri = (verb: IntakeVerb) =>
  `https://ratstack.sh/xapi/verbs/${verb}` as const;

export const xapiObjectIri = (object: IntakeObject) =>
  `https://ratstack.sh/xapi/${object}` as const;

export class IntakeEvents extends Context.Service<
  IntakeEvents,
  {
    readonly erase: (actor: ContactRef) => Effect.Effect<void>;
    readonly record: (
      statements: readonly IntakeStatement[],
      contact?: IntakeContact
    ) => Effect.Effect<void, IntakeEventsUnavailable>;
  }
>()("@rat-stack/core/IntakeEvents") {
  static readonly testLayer = Layer.unwrap(
    Effect.gen(function* makeTestIntakeEvents() {
      const stored = yield* Ref.make<readonly IntakeStatement[]>([]);
      const contacts = yield* Ref.make<readonly RecordedContact[]>([]);
      const erased = yield* Ref.make<readonly ContactRef[]>([]);

      return Layer.mergeAll(
        Layer.succeed(IntakeEvents, {
          erase: (actor) =>
            Effect.all([
              Ref.update(stored, (all) =>
                all.filter((statement) => statement.actor !== actor)
              ),
              Ref.update(contacts, (all) =>
                all.filter((contact) => contact.actor !== actor)
              ),
              Ref.update(erased, (all) => [...all, actor]),
            ]),
          record: (statements, contact) =>
            Effect.andThen(
              Ref.update(stored, (all) => {
                const known = new Set(all.map((statement) => statement.id));

                return [
                  ...all,
                  ...statements.filter((statement) => !known.has(statement.id)),
                ];
              }),
              Ref.update(contacts, (all) => {
                const [first] = statements;

                if (contact === undefined || first === undefined) {
                  return all;
                }

                const { submissionId } = first.context;

                return all.some((held) => held.submissionId === submissionId)
                  ? all
                  : [...all, { ...contact, actor: first.actor, submissionId }];
              })
            ),
        }),
        Layer.succeed(IntakeEventsTest, {
          contacts: Ref.get(contacts),
          erased: Ref.get(erased),
          statements: Ref.get(stored),
        })
      );
    })
  );

  static readonly unavailableTestLayer = Layer.succeed(this, {
    erase: () => Effect.void,
    record: () => Effect.fail(new IntakeEventsUnavailable({})),
  });
}
