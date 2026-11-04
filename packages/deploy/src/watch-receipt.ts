import { VerdictSchema } from "@rat-stack/check-harness";
import { Runtime, Schema } from "effect";

import { refusalFix, refusalMessage, RefusalReasonSchema } from "./refusals.js";
import type { RefusalReason } from "./refusals.js";
import { RollbackReceiptSchema } from "./rollback-contracts.js";

export const WatchOutcomeSchema = Schema.Literals([
  "passed",
  "rolled-back",
  "rollback-failed",
  "crashed",
  "interrupted",
]);

export type WatchOutcome = typeof WatchOutcomeSchema.Type;

export const WatchReceiptSchema = Schema.Struct({
  check: Schema.optionalKey(VerdictSchema),
  fix: Schema.optionalKey(Schema.String),
  operation: Schema.Literal("post-deploy-watch"),
  outcome: WatchOutcomeSchema,
  profile: Schema.NonEmptyString,
  reason: Schema.String,
  rollback: Schema.optionalKey(RollbackReceiptSchema),
  rollbackReason: Schema.optionalKey(Schema.String),
});

export type WatchReceipt = typeof WatchReceiptSchema.Type;

const failureReasons: Record<Exclude<WatchOutcome, "passed">, RefusalReason> = {
  crashed: "post-deploy-watch-crashed",
  interrupted: "post-deploy-watch-interrupted",
  "rollback-failed": "post-deploy-watch-rollback-failed",
  "rolled-back": "post-deploy-watch-failed",
};

export const watchReceipt = (
  profile: string,
  outcome: WatchOutcome,
  details: Pick<WatchReceipt, "check" | "rollback" | "rollbackReason"> = {}
): WatchReceipt => {
  if (outcome === "passed") {
    return {
      ...details,
      operation: "post-deploy-watch",
      outcome,
      profile,
      reason: "bounded-watch-confirmed",
    };
  }

  const reason = failureReasons[outcome];
  const fix = refusalFix(reason)?.replaceAll("<profile>", profile);

  const receipt: WatchReceipt = {
    ...details,
    operation: "post-deploy-watch",
    outcome,
    profile,
    reason,
  };

  return fix === undefined ? receipt : { ...receipt, fix };
};

const exitCodes: Record<WatchOutcome, number> = {
  crashed: 5,
  interrupted: 3,
  passed: 0,
  "rollback-failed": 4,
  "rolled-back": 2,
};

export class DeployWatchFailed extends Schema.TaggedError<
  DeployWatchFailed,
  { readonly brand: unique symbol }
>()("DeployWatchFailed", {
  reason: RefusalReasonSchema,
  receipt: WatchReceiptSchema,
}) {
  override get message() {
    return refusalMessage(
      this.reason,
      `Post-deploy watch for ${this.receipt.profile}`
    );
  }

  override get [Runtime.errorExitCode]() {
    return exitCodes[this.receipt.outcome];
  }

  override readonly [Runtime.errorReported] = true;
}

export const watchFailure = (receipt: WatchReceipt) =>
  receipt.outcome === "passed"
    ? undefined
    : new DeployWatchFailed({
        reason: failureReasons[receipt.outcome],
        receipt,
      });
