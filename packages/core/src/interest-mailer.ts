import { Context, Effect, Layer, Redacted, Ref } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { MailerFailed } from "./mailer-failed.js";
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

export interface PostShibaSettings {
  readonly apiKey: Redacted.Redacted;
  readonly baseUrl?: string;
  readonly cluster: string;
  readonly enabled: boolean;
  readonly team: string;
}

const DEFAULT_BASE_URL = "https://app.postshiba.com";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const plainTextToHtml = (text: string) =>
  text
    .split(/\n{2,}/u)
    .map((paragraph) =>
      escapeHtml(paragraph)
        .replaceAll(/(?<url>https?:\/\/\S+)/gu, '<a href="$<url>">$<url></a>')
        .replaceAll("\n", "<br>")
    )
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("\n");

export const sendsUrl = (settings: PostShibaSettings) =>
  `${settings.baseUrl ?? DEFAULT_BASE_URL}/api/v1/teams/${settings.team}/clusters/${settings.cluster}/sends`;

export const postShibaMailerLayer = (settings: PostShibaSettings) =>
  Layer.effect(
    InterestMailer,
    Effect.gen(function* makePostShibaMailer() {
      const http = yield* HttpClient.HttpClient;

      const send = Effect.fn("InterestMailer.send")(function* send(
        mail: InterestMail
      ) {
        if (!settings.enabled) {
          yield* Effect.logInfo("interest mail skipped: sending is disabled");

          return "skipped" as const;
        }

        const request = HttpClientRequest.post(sendsUrl(settings)).pipe(
          HttpClientRequest.bearerToken(Redacted.value(settings.apiKey)),
          HttpClientRequest.setHeader("idempotency-key", mail.idempotencyKey),
          HttpClientRequest.bodyJsonUnsafe({
            from: mail.from,
            headers: {},
            html: plainTextToHtml(mail.text),
            sandbox: false,
            subject: mail.subject,
            text: mail.text,
            to: [mail.to],
            unique_args: {},
          })
        );

        const response = yield* http
          .execute(request)
          .pipe(
            Effect.mapError(
              (error) =>
                new MailerFailed({ reason: `network:${error.message}` })
            )
          );

        if (response.status !== 200 && response.status !== 201) {
          return yield* new MailerFailed({
            reason: `http_${String(response.status)}`,
          });
        }

        return "sent" as const;
      });

      return { send };
    })
  );
