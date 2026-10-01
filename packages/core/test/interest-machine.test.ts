import { expect, it } from "@effect/vitest";
import { Clock, Effect } from "effect";
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

  const capture = {
    consentVersion: "test-consent",
    ipHash: "ip-hash",
    submissionId: "submission-1",
    uaHash: "ua-hash",
  } as const;

  test.effect(
    "captures a new address with its evidence, no expiry, and no mail",
    () =>
      Effect.gen(function* capturesNew() {
        const directory = yield* InterestDirectory;
        yield* TestClock.adjust(HOUR_MS);

        const now = yield* Clock.currentTimeMillis;

        const outcome = yield* directory.register(
          "cap-new@example.com",
          capture
        );

        expect(outcome).toEqual(
          interestOutcome.Captured({
            record: {
              address: "cap-new@example.com",
              capture: { ...capture, capturedAt: now },
              requestedAt: now,
              status: "captured",
            },
          })
        );
      })
  );

  test.effect(
    "keeps a capture, its evidence, and its count after the confirmation window",
    () =>
      Effect.gen(function* keepsCapture() {
        const directory = yield* InterestDirectory;
        yield* directory.register("cap-keep@example.com", capture);
        yield* TestClock.adjust(CONFIRMATION_WINDOW_MS * 10);

        const again = yield* directory.register("cap-keep@example.com", {
          ...capture,
          submissionId: "submission-2",
        });

        const kept = (yield* directory.captures).find(
          (record) => record.address === "cap-keep@example.com"
        );

        expect(again).toEqual(interestOutcome.Quiet({ reason: "on-file" }));
        expect(kept?.capture?.submissionId).toBe("submission-1");
        expect((yield* directory.summary).captured).toBeGreaterThanOrEqual(1);
      })
  );

  test.effect("refuses a confirmation for a captured address", () =>
    Effect.gen(function* refusesCaptured() {
      const directory = yield* InterestDirectory;
      yield* directory.register("cap-confirm@example.com", capture);

      expect(yield* directory.confirm("cap-confirm@example.com")).toEqual(
        interestOutcome.ConfirmRefused({ reason: "unknown" })
      );
    })
  );

  test.effect(
    "leaves a pending address untouched when a capture-mode submission repeats it",
    () =>
      Effect.gen(function* leavesPending() {
        const directory = yield* InterestDirectory;
        yield* directory.register("cap-pending@example.com");
        yield* TestClock.adjust(RESEND_COOLDOWN_MS);

        expect(
          yield* directory.register("cap-pending@example.com", capture)
        ).toEqual(interestOutcome.Quiet({ reason: "on-file" }));
        expect(
          (yield* directory.captures).some(
            (record) => record.address === "cap-pending@example.com"
          )
        ).toBe(false);
      })
  );

  test.effect(
    "captures an address whose earlier confirmation window ran out",
    () =>
      Effect.gen(function* capturesExpired() {
        const directory = yield* InterestDirectory;
        yield* directory.register("cap-expired@example.com");
        yield* TestClock.adjust(CONFIRMATION_WINDOW_MS);

        expect(
          interestOutcome.$is("Captured")(
            yield* directory.register("cap-expired@example.com", capture)
          )
        ).toBe(true);
      })
  );

  test.effect("removes records by address and by submission id", () =>
    Effect.gen(function* removes() {
      const directory = yield* InterestDirectory;
      yield* directory.register("rm-a@example.com", capture);
      yield* directory.register("rm-b@example.com", {
        ...capture,
        submissionId: "submission-b",
      });

      expect(
        yield* directory.remove({ submissionIds: ["submission-b", "nope"] })
      ).toEqual({ deleted: 1, notFound: 1, requested: 2 });
      expect(
        yield* directory.remove({ addresses: ["RM-A@example.com"] })
      ).toEqual({ deleted: 1, notFound: 0, requested: 1 });
      expect(
        (yield* directory.captures).some(({ address: entry }) =>
          entry.startsWith("rm-")
        )
      ).toBe(false);
    })
  );
});
