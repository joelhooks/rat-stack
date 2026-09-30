import { implement } from "@rat-stack/capability/implement";
import {
  CONFIRM_ANSWER,
  InterestDirectory,
  InterestGate,
  InterestLinkRefused,
  InterestMailer,
  InterestRequest,
  InterestTokens,
  InvalidInterestAddress,
  REGISTER_ANSWER,
  confirmInterestContract,
  interestOutcome,
  normalizeAddress,
  registerInterestContract,
  sha256Hex,
} from "@rat-stack/core/interest";
import { Clock, Effect, Option } from "effect";

import {
  confirmationTemplate,
  confirmationText,
} from "./confirmation-email.js";

const registered = { message: REGISTER_ANSWER } as const;

const confirmLinkFor = (origin: string, token: string) =>
  `${origin}/tokenmaxx/confirm?token=${encodeURIComponent(token)}`;

const sendConfirmation = Effect.fn("sendConfirmation")(
  function* sendConfirmation(
    address: string,
    record: { readonly expiresAt: number; readonly lastSentAt?: number }
  ) {
    const request = yield* InterestRequest;
    const tokens = yield* InterestTokens;
    const mailer = yield* InterestMailer;
    const directory = yield* InterestDirectory;

    const token = yield* tokens.sign({
      address,
      expiresAt: record.expiresAt,
    });

    const idempotencyKey = yield* sha256Hex(
      `${address}:${String(record.lastSentAt ?? 0)}`
    );

    const result = yield* mailer
      .send({
        from: confirmationTemplate.from,
        idempotencyKey,
        subject: confirmationTemplate.subject,
        text: confirmationText(
          confirmationTemplate,
          confirmLinkFor(request.origin, token)
        ),
        to: address,
      })
      .pipe(
        Effect.catchTag("MailerFailed", (failure) =>
          Effect.logWarning(`interest mail failed: ${failure.reason}`).pipe(
            Effect.as("failed" as const)
          )
        )
      );

    if (result !== "sent") {
      yield* directory.mailFailed(address);
    }
  }
);

export const registerInterest = implement(
  registerInterestContract,
  ({ email, website }) =>
    Effect.gen(function* registerInterestHandler() {
      if (website !== undefined && website.trim() !== "") {
        return registered;
      }

      const request = yield* InterestRequest;
      const gate = yield* InterestGate;

      if (!(yield* gate.allow(request.ip))) {
        return registered;
      }

      const address = normalizeAddress(email);

      if (Option.isNone(address)) {
        return yield* new InvalidInterestAddress({
          message: "That does not look like an email address.",
        });
      }

      const directory = yield* InterestDirectory;
      const outcome = yield* directory.register(address.value);

      if (interestOutcome.$is("SendConfirmation")(outcome)) {
        yield* sendConfirmation(address.value, outcome.record);
      }

      return registered;
    })
);

const refusal = (reason: "expired" | "invalid") =>
  new InterestLinkRefused({
    message:
      reason === "expired"
        ? "That link has expired. Ask for a new confirmation email from the workshop page."
        : "That link is not valid. Ask for a new confirmation email from the workshop page.",
    reason,
  });

export const confirmInterest = implement(confirmInterestContract, ({ token }) =>
  Effect.gen(function* confirmInterestHandler() {
    const tokens = yield* InterestTokens;
    const directory = yield* InterestDirectory;
    const now = yield* Clock.currentTimeMillis;

    const claims = yield* tokens
      .verify(token, now)
      .pipe(
        Effect.mapError((failure) =>
          refusal(failure.reason === "expired" ? "expired" : "invalid")
        )
      );

    const outcome = yield* directory.confirm(claims.address);

    return yield* interestOutcome.$match(outcome, {
      ConfirmRefused: ({ reason }) =>
        Effect.fail(refusal(reason === "expired" ? "expired" : "invalid")),
      Confirmed: () => Effect.succeed({ message: CONFIRM_ANSWER } as const),
      Quiet: () =>
        Effect.die(new Error("a confirmation cannot settle quietly")),
      SendConfirmation: () =>
        Effect.die(new Error("a confirmation cannot send mail")),
    });
  })
);

export const interestCapabilities = [
  registerInterest,
  confirmInterest,
] as const;
