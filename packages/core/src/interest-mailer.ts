import { Context, Effect, Layer, Ref } from "effect";

import type { MailerFailed } from "./mailer-failed.js";
import { RecordedMail } from "./recorded-mail.js";

export interface InterestMail {
  readonly from: string;
  readonly idempotencyKey: string;
  readonly subject: string;
  readonly text: string;
  readonly to: string;
}

export type MailResult = "sent" | "skipped";

export class InterestMailer extends Context.Service<
  InterestMailer,
  {
    readonly send: (
      mail: InterestMail
    ) => Effect.Effect<MailResult, MailerFailed>;
  }
>()("@rat-stack/core/InterestMailer") {}

export const recordingMailerLayer = Layer.effectContext(
  Effect.gen(function* makeRecordingMailer() {
    const sent = yield* Ref.make<readonly InterestMail[]>([]);

    return Context.make(InterestMailer, {
      send: (mail: InterestMail) =>
        Ref.update(sent, (all) => [...all, mail]).pipe(
          Effect.as<MailResult>("sent")
        ),
    }).pipe(Context.add(RecordedMail, { all: Ref.get(sent) }));
  })
);
