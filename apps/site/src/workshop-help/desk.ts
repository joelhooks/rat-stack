import { SetupHelpDesk } from "@rat-stack/core/tokenmaxx-help";
import { HelpUnavailable } from "@rat-stack/core/tokenmaxx-help-contracts";
import {
  HelpFileOutcome,
  HelpLookup,
  HelpPage,
} from "@rat-stack/core/tokenmaxx-help-store";
import type {
  HelpListQuery,
  NewHelpReport,
} from "@rat-stack/core/tokenmaxx-help-store";
import { Cause, Effect, Layer, Schema } from "effect";

export const HELP_DESK_INSTANCE = "desk";

export interface HelpDeskStub {
  readonly answer: (reportId: string, answer: string) => Effect.Effect<unknown>;
  readonly file: (report: typeof NewHelpReport.Type) => Effect.Effect<unknown>;
  readonly find: (reportId: string) => Effect.Effect<unknown>;
  readonly list: (query: typeof HelpListQuery.Type) => Effect.Effect<unknown>;
}

const storageFailure = new HelpUnavailable({
  message:
    "The workshop help desk couldn't confirm it saved or read this report. Try again in a minute; sending the same report twice is fine.",
  reason: "storage",
});

const through =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (call: Effect.Effect<unknown>) =>
    call.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Workshop help desk storage failed", cause).pipe(
              Effect.andThen(Effect.fail(storageFailure))
            )
      )
    );

export const helpDeskLayer = (desk: () => HelpDeskStub) =>
  Layer.succeed(SetupHelpDesk, {
    answer: (reportId, answer) =>
      through(HelpLookup)(
        Effect.suspend(() => desk().answer(reportId, answer))
      ),
    file: (report) =>
      through(HelpFileOutcome)(Effect.suspend(() => desk().file(report))),
    find: (reportId) =>
      through(HelpLookup)(Effect.suspend(() => desk().find(reportId))),
    list: (query) =>
      through(HelpPage)(Effect.suspend(() => desk().list(query))),
  });
