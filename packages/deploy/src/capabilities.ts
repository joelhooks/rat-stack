import { Approval } from "@rat-stack/capability/approval";
import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import { Effect, Option, Runtime, Schema } from "effect";

import { DeployReportSchema, deployReport } from "./contracts.js";
import type { DeployVerdict } from "./contracts.js";
import { runDeploy } from "./machine.js";
import { PlanRowSchema } from "./plan.js";
import { ReceiptStore } from "./receipt-store.js";
import { deployRollback } from "./rollback.js";
import { CommitShaSchema } from "./source.js";

export class DeployNotHealthy extends Schema.TaggedError<DeployNotHealthy>()(
  "DeployNotHealthy",
  { report: DeployReportSchema }
) {
  override get [Runtime.errorExitCode]() {
    if (this.report.outcome === "partial") {
      return 4;
    }

    if (this.report.outcome === "crashed") {
      return 5;
    }

    return this.report.outcome === "unknown" ? 3 : 2;
  }
  override readonly [Runtime.errorReported] = true;
}

const input = Schema.Struct({
  allow: Schema.optionalKey(Schema.Array(PlanRowSchema)),
  expectSha: Schema.optionalKey(CommitShaSchema),
  ownerApproved: Schema.optionalKey(Schema.Boolean),
  profile: Schema.NonEmptyString,
});

export const deployPlanContract = defineContract("deployPlan", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Read and classify the production deployment plan without applying it",
  failure: DeployNotHealthy,
  input,
  output: DeployReportSchema,
});

export const deployProdContract = defineContract("deployProd", {
  annotations: { destructive: true, idempotent: false, readOnly: false },
  description:
    "Apply an approved production deployment plan and prove the live behavior",
  failure: DeployNotHealthy,
  input,
  needsApproval: true,
  output: DeployReportSchema,
});

const reportVerdict = Effect.fn("reportVerdict")(function* reportVerdict(
  profile: string,
  verdict: DeployVerdict
) {
  const receipts = yield* ReceiptStore;

  const saved = yield* receipts
    .saveVerdict(profile, verdict)
    .pipe(Effect.option);

  return deployReport(profile, verdict, Option.getOrUndefined(saved));
});

export const deployPlan = implement(deployPlanContract, (value) =>
  runDeploy({ ...value, allow: value.allow ?? [], mode: "plan" }).pipe(
    Effect.provide(Approval.denyAll),
    Effect.flatMap((verdict) => reportVerdict(value.profile, verdict)),
    Effect.filterOrFail(
      (report) => report.outcome === "planned",
      (report) => new DeployNotHealthy({ report })
    )
  )
);

export const deployProd = implement(deployProdContract, (value) =>
  runDeploy({ ...value, allow: value.allow ?? [], mode: "prod" }).pipe(
    Effect.flatMap((verdict) => reportVerdict(value.profile, verdict)),
    Effect.filterOrFail(
      (report) => report.outcome === "healthy",
      (report) => new DeployNotHealthy({ report })
    )
  )
);

export const capabilities = [deployPlan, deployProd, deployRollback] as const;
