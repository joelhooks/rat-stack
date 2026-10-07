import type { Approval } from "@rat-stack/capability/approval";
import type { Verdict } from "@rat-stack/check-harness";
import type { Effect } from "effect";
import { Context } from "effect";

import type {
  ApplyReceipt,
  DeployInput,
  DeployStepError,
  PreparedPlan,
} from "./contracts.js";
import type { CheckoutState } from "./source.js";

export class DeployRunner extends Context.Service<
  DeployRunner,
  {
    readonly source: () => Effect.Effect<CheckoutState, DeployStepError>;
    readonly preflight: (
      input: DeployInput
    ) => Effect.Effect<readonly string[], DeployStepError>;
    readonly plan: (
      input: DeployInput
    ) => Effect.Effect<PreparedPlan, DeployStepError>;
    readonly apply: (
      input: DeployInput
    ) => Effect.Effect<ApplyReceipt, DeployStepError, Approval>;
    readonly checks: (
      receipt: ApplyReceipt
    ) => Effect.Effect<readonly Verdict[], DeployStepError>;
  }
>()("@rat-stack/deploy/DeployRunner") {}
