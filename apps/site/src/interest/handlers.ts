import { implement } from "@rat-stack/capability/implement";
import {
  CONFIRM_ANSWER,
  InterestDirectory,
  InterestLinkRefused,
  InterestTokens,
  confirmInterestContract,
  interestOutcome,
} from "@rat-stack/core/interest";
import { Clock, Effect } from "effect";

export const refusalMessage = (reason: "expired" | "invalid") =>
  reason === "expired"
    ? "Confirmation links expire in 72 hours. Return to the workshop page to apply through your agent and request a new link."
    : "Return to the workshop page to apply through your agent and request a confirmation link.";

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

export const interestCapabilities = [confirmInterest] as const;
