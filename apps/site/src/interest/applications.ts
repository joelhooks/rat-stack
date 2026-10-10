import type { ContactRef } from "@rat-stack/core/intake";
import {
  IntakeApplications,
  IntakeApplicationsUnavailable,
  IntakeApplicationSchema,
  JoinContactStore,
} from "@rat-stack/core/join-interest";
import type { IntakeApplication } from "@rat-stack/core/join-interest";
import { unsealApplication } from "@rat-stack/intake-live";
import type { SealedRow } from "@rat-stack/intake-live";
import { Effect, Layer, Logger, Schema } from "effect";

export interface IntakeReadStub {
  readonly intakeRead: () => Effect.Effect<{
    readonly key: string | undefined;
    readonly rows: readonly SealedRow[];
  }>;
}

const readApplication = Effect.fnUntraced(function* readApplication(
  contacts: JoinContactStore["Service"],
  vault: (actor: ContactRef) => IntakeReadStub,
  ids: () => Effect.Effect<readonly string[]>,
  submissionId: string
): Effect.fn.Return<IntakeApplication, IntakeApplicationsUnavailable> {
  const contact = yield* contacts.read(submissionId);

  if (contact === undefined) {
    if ((yield* ids()).includes(submissionId)) {
      return { reason: "erased", state: "erased", submissionId };
    }

    return {
      reason: "no answers: legacy browser signup or erased contact",
      state: "no-answers",
      submissionId,
    };
  }

  const sealed = yield* vault(contact.contactRef).intakeRead();

  if (sealed.key === undefined || sealed.rows.length === 0) {
    return { reason: "erased", state: "erased", submissionId };
  }

  const application = yield* unsealApplication(sealed.rows, sealed.key);

  if (
    application.submissionId !== submissionId ||
    application.contactRef !== contact.contactRef
  ) {
    return yield* new IntakeApplicationsUnavailable({});
  }

  return yield* Schema.decodeEffect(IntakeApplicationSchema)({
    ...application,
    email: contact.email,
    state: contact.state === "accepted" ? "forwarded" : "held",
  }).pipe(Effect.mapError(() => new IntakeApplicationsUnavailable({})));
});

const listApplications = (
  ids: () => Effect.Effect<readonly string[]>,
  contacts: JoinContactStore["Service"],
  vault: (actor: ContactRef) => IntakeReadStub,
  submissionId?: string
) =>
  Effect.gen(function* enumerateApplications() {
    const submissions =
      submissionId === undefined ? yield* ids() : [submissionId];

    return yield* Effect.forEach([...new Set(submissions)], (id) =>
      readApplication(contacts, vault, ids, id)
    );
  }).pipe(
    Effect.withTracerEnabled(false),
    Effect.provide(Logger.layer([])),
    Effect.catchCause(() => Effect.fail(new IntakeApplicationsUnavailable({})))
  );

export const intakeApplicationsLayer = (
  ids: () => Effect.Effect<readonly string[]>,
  vault: (actor: ContactRef) => IntakeReadStub
) =>
  Layer.effect(
    IntakeApplications,
    Effect.gen(function* makeApplicationsReader() {
      const contacts = yield* JoinContactStore;

      return {
        list: (submissionId?: string) =>
          listApplications(ids, contacts, vault, submissionId),
      };
    })
  );
