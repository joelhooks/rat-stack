import { InterestMailer, MailerFailed } from "@rat-stack/core/interest";
import type { InterestMail } from "@rat-stack/core/interest";
import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

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
