import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { InterestDirectory } from "../src/interest-directory.js";
import {
  CONFIRMATION_WINDOW_MS,
  RESEND_COOLDOWN_MS,
  interestOutcome,
} from "../src/interest-machine.js";

const address = "reader@example.com";

const HOUR_MS = 60 * 60 * 1000;

it.layer(InterestDirectory.memory)("interest lifecycle", (test) => {
  test.effect(
    "registers a new address and asks for one confirmation email",
    () =>
      Effect.gen(function* registersNew() {
        const directory = yield* InterestDirectory;
        const outcome = yield* directory.register(address);

        expect(outcome).toEqual(
          interestOutcome.SendConfirmation({
            record: {
              address,
              expiresAt: CONFIRMATION_WINDOW_MS,
              lastSentAt: 0,
              requestedAt: 0,
              status: "pending",
            },
          })
        );
      })
  );

  test.effect("stays quiet for a second request inside the cooldown", () =>
    Effect.gen(function* staysQuiet() {
      const directory = yield* InterestDirectory;
      yield* directory.register("cooldown@example.com");
      yield* TestClock.adjust(RESEND_COOLDOWN_MS - 1);

      expect(yield* directory.register("cooldown@example.com")).toEqual(
        interestOutcome.Quiet({ reason: "cooldown" })
      );
    })
  );

  test.effect("resends once the cooldown passes, keeping the expiry", () =>
    Effect.gen(function* resends() {
      const directory = yield* InterestDirectory;
      const first = yield* directory.register("resend@example.com");
      yield* TestClock.adjust(RESEND_COOLDOWN_MS);
      const second = yield* directory.register("resend@example.com");

      const isSend = interestOutcome.$is("SendConfirmation");

      expect(isSend(first) && isSend(second)).toBe(true);
      expect(isSend(second) ? second.record.expiresAt : undefined).toBe(
        isSend(first) ? first.record.expiresAt : undefined
      );
    })
  );

  test.effect("confirms inside the window and then stays quiet", () =>
    Effect.gen(function* confirms() {
      const directory = yield* InterestDirectory;
      yield* directory.register("confirm@example.com");
      yield* TestClock.adjust(HOUR_MS);
      const confirmed = yield* directory.confirm("confirm@example.com");
      const again = yield* directory.register("confirm@example.com");
      const summary = yield* directory.summary;

      expect(
        interestOutcome.$is("Confirmed")(confirmed) &&
          confirmed.record.status === "confirmed"
      ).toBe(true);
      expect(again).toEqual(interestOutcome.Quiet({ reason: "confirmed" }));
      expect(summary.confirmed.map(({ address: entry }) => entry)).toContain(
        "confirm@example.com"
      );
    })
  );

  test.effect(
    "refuses a confirmation after the window and lets the address start over",
    () =>
      Effect.gen(function* expires() {
        const directory = yield* InterestDirectory;
        yield* directory.register("late@example.com");
        yield* TestClock.adjust(CONFIRMATION_WINDOW_MS);

        expect(yield* directory.confirm("late@example.com")).toEqual(
          interestOutcome.ConfirmRefused({ reason: "expired" })
        );

        const restarted = yield* directory.register("late@example.com");

        expect(interestOutcome.$is("SendConfirmation")(restarted)).toBe(true);
        expect(
          interestOutcome.$is("Confirmed")(
            yield* directory.confirm("late@example.com")
          )
        ).toBe(true);
      })
  );

  test.effect(
    "refuses a confirmation for an address that never registered",
    () =>
      Effect.gen(function* refusesUnknown() {
        const directory = yield* InterestDirectory;

        expect(yield* directory.confirm("nobody@example.com")).toEqual(
          interestOutcome.ConfirmRefused({ reason: "unknown" })
        );
      })
  );

  test.effect(
    "lets a failed mail try again without waiting out the cooldown",
    () =>
      Effect.gen(function* retriesAfterFailure() {
        const directory = yield* InterestDirectory;
        yield* directory.register("retry@example.com");
        yield* directory.mailFailed("retry@example.com");

        expect(
          interestOutcome.$is("SendConfirmation")(
            yield* directory.register("retry@example.com")
          )
        ).toBe(true);
      })
  );

  test.effect("counts only unexpired pending addresses", () =>
    Effect.gen(function* countsPending() {
      const directory = yield* InterestDirectory;
      const before = yield* directory.summary;
      yield* directory.register("count-one@example.com");
      yield* directory.register("count-two@example.com");
      const during = yield* directory.summary;
      yield* TestClock.adjust(CONFIRMATION_WINDOW_MS);
      const after = yield* directory.summary;

      expect(during.pending - before.pending).toBe(2);
      expect(after.pending).toBe(0);
    })
  );
});
