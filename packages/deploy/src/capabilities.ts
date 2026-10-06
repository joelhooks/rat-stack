import { Approval } from "@rat-stack/capability/approval";
import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import { Effect, Runtime, Schema } from "effect";

import { DeployVerdictSchema } from "./contracts.js";
import { runDeploy } from "./machine.js";
import { PlanRowSchema } from "./plan.js";
import { deployRollback } from "./rollback.js";

export class DeployNotHealthy extends Schema.TaggedError<DeployNotHealthy>()(
  "DeployNotHealthy",
  { verdict: DeployVerdictSchema }
) {
  override get [Runtime.errorExitCode]() {
    if (this.verdict.outcome === "partial") {
      return 4;
    }

    if (this.verdict.outcome === "crashed") {
      return 5;
    }

    return this.verdict.outcome === "unknown" ? 3 : 2;
  }
  override readonly [Runtime.errorReported] = true;
}

const input = Schema.Struct({
  allow: Schema.optionalKey(Schema.Array(PlanRowSchema)),
  ownerApproved: Schema.optionalKey(Schema.Boolean),
  profile: Schema.NonEmptyString,
});

export const deployPlanContract = defineContract("deployPlan", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Read and classify the production deployment plan without applying it",
  failure: DeployNotHealthy,
  input,
  output: DeployVerdictSchema,
});

export const deployProdContract = defineContract("deployProd", {
  annotations: { destructive: true, idempotent: false, readOnly: false },
  description:
    "Apply an approved production deployment plan and prove the live behavior",
  failure: DeployNotHealthy,
  input,
  needsApproval: true,
  output: DeployVerdictSchema,
});

export const deployPlan = implement(deployPlanContract, (value) =>
  runDeploy({ ...value, allow: value.allow ?? [], mode: "plan" }).pipe(
    Effect.provide(Approval.denyAll),
    Effect.filterOrFail(
      (verdict) => verdict.outcome === "planned",
      (verdict) => new DeployNotHealthy({ verdict })
    )
  )
);

export const deployProd = implement(deployProdContract, (value) =>
  runDeploy({ ...value, allow: value.allow ?? [], mode: "prod" }).pipe(
    Effect.filterOrFail(
      (verdict) => verdict.outcome === "healthy",
      (verdict) => new DeployNotHealthy({ verdict })
    )
  )
);

export const capabilities = [deployPlan, deployProd, deployRollback] as const;
