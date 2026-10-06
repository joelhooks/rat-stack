import type { Verdict } from "@rat-stack/check-harness";
import type { Effect } from "effect";
import { Context } from "effect";

import type {
  ApplyReceipt,
  DeployInput,
  DeployStepError,
} from "./contracts.js";

export class DeployRunner extends Context.Service<
  DeployRunner,
  {
    readonly preflight: (
      input: DeployInput
    ) => Effect.Effect<readonly string[], DeployStepError>;
    readonly plan: (
      input: DeployInput
    ) => Effect.Effect<string, DeployStepError>;
    readonly apply: (
      input: DeployInput
    ) => Effect.Effect<ApplyReceipt, DeployStepError>;
    readonly checks: (
      receipt: ApplyReceipt
    ) => Effect.Effect<readonly Verdict[], DeployStepError>;
  }
>()("@rat-stack/deploy/DeployRunner") {}
