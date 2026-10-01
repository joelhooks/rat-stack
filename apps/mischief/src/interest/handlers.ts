import { implement } from "@rat-stack/capability/implement";
import {
  CAPTURE_ANSWER,
  CONFIRM_ANSWER,
  CONFIRMATION_WINDOW_MS,
  CONSENT_VERSION,
  DrovrIntake,
  InterestDirectory,
  InterestGate,
  InterestLinkRefused,
  InterestMailer,
  InterestMode,
  InterestRequest,
  InterestTokens,
  InvalidInterestAddress,
  REGISTER_ANSWER,
  confirmInterestContract,
  interestOutcome,
  normalizeAddress,
  normalizeClientIp,
  registerInterestContract,
  sha256Hex,
} from "@rat-stack/core/interest";
import type { InterestRecord } from "@rat-stack/core/interest";
import { Clock, Duration, Effect, Option } from "effect";

import {
  confirmationTemplate,
  confirmationText,
} from "./confirmation-email.js";

const answerFor = (mode: "capture" | "doi" | "drovr") =>
  ({ message: mode === "capture" ? CAPTURE_ANSWER : REGISTER_ANSWER }) as const;

const tryAgain = new InvalidInterestAddress({
  message: "We couldn't verify that. Please try again.",
});

const INTAKE_MAX_RETRIES = 2;

const INTAKE_MAX_WAIT_SECONDS = 3;

const captureRequest = Effect.fn("captureRequest")(function* captureRequest() {
  const request = yield* InterestRequest;
  const tokens = yield* InterestTokens;

  const ip = normalizeClientIp(request.ip).pipe(
    Option.getOrElse(() => request.ip ?? "")
  );

  const [ipHash, uaHash, submissionId] = yield* Effect.all([
    tokens.digest("ip", ip),
    tokens.digest("ua", request.userAgent),
    // @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off -- Web Crypto is the Worker runtime; the Effect Crypto service needs a platform layer this Worker does not provide.
    Effect.sync(() => crypto.randomUUID()),
  ]);

  return {
    consentVersion: CONSENT_VERSION,
    ipHash,
    submissionId,
    uaHash,
  } as const;
});

const confirmLinkFor = (origin: string, token: string) =>
  `${origin}/tokenmaxx/confirm?token=${encodeURIComponent(token)}`;

const sendConfirmation = Effect.fn("sendConfirmation")(
  function* sendConfirmation(address: string, record: InterestRecord) {
    const request = yield* InterestRequest;
    const tokens = yield* InterestTokens;
    const mailer = yield* InterestMailer;
    const directory = yield* InterestDirectory;

    const token = yield* tokens.sign({
      address,
      expiresAt:
        record.expiresAt ?? record.requestedAt + CONFIRMATION_WINDOW_MS,
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
  ({ email, shieldToken, website }) =>
    Effect.gen(function* registerInterestHandler() {
      const mode = yield* InterestMode;
      const registered = answerFor(mode);

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

      if (mode === "drovr") {
        const challenge = (shieldToken ?? "").trim();

        if (challenge === "") {
          return yield* tryAgain;
        }

        const clientIp = normalizeClientIp(request.ip);

        if (Option.isNone(clientIp)) {
          yield* Effect.logInfo("interest intake refused: no client ip");

          return registered;
        }

        const tokens = yield* InterestTokens;
        const intake = yield* DrovrIntake;

        const [ipHash, uaHash, submissionId] = yield* Effect.all([
          tokens.digest("ip", clientIp.value),
          tokens.digest("ua", request.userAgent),
          // @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off -- Web Crypto is the Worker runtime; the Effect Crypto service needs a platform layer this Worker does not provide.
          Effect.sync(() => crypto.randomUUID()),
        ]);

        let attempts = 0;
        let accepted = false;

        while (!accepted) {
          const result = yield* intake.submit({
            challenge,
            clientBucket: { ipHash, uaHash },
            email,
            submissionId,
          });

          if (result.kind === "accepted") {
            accepted = true;
          } else if (
            result.kind === "retry" &&
            attempts < INTAKE_MAX_RETRIES &&
            result.afterSeconds <= INTAKE_MAX_WAIT_SECONDS
          ) {
            attempts += 1;
            yield* Effect.sleep(Duration.seconds(result.afterSeconds));
          } else {
            return yield* tryAgain;
          }
        }

        return registered;
      }

      if (mode === "capture") {
        yield* directory.register(address.value, yield* captureRequest());

        return registered;
      }

      const outcome = yield* directory.register(address.value);

      if (interestOutcome.$is("SendConfirmation")(outcome)) {
        yield* sendConfirmation(address.value, outcome.record);
      }

      return registered;
    })
);

export const refusalMessage = (reason: "expired" | "invalid") =>
  reason === "expired"
    ? "Confirmation links expire in 72 hours. Return to the signup form to request a new link."
    : "Return to the signup form to request a confirmation link.";

const refusal = (reason: "expired" | "invalid") =>
  new InterestLinkRefused({ message: refusalMessage(reason), reason });

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
      Captured: () =>
        Effect.die(new Error("a confirmation cannot capture an address")),
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
