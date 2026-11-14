import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  fenceMessage,
  placeholderValue,
} from "../../core/test/fixtures/fence-message.js";
import { DeployStepError } from "../src/contracts.js";
import { PlanRejected } from "../src/plan.js";
import { RefusalReasonSchema } from "../src/refusals.js";
import { RollbackRefused } from "../src/rollback-refused.js";
import { refuse, StateCopyRefusalSchema } from "../src/state-copy.js";
import { DeployWatchFailed, watchReceipt } from "../src/watch-receipt.js";

const names = Arbitrary.array(Arbitrary.schema(placeholderValue), {
  maxLength: 3,
});

it.prop(
  "every deploy, plan, rollback, and post-deploy watch refusal names what, why, and the fix",
  {
    keys: names,
    reason: Arbitrary.schema(RefusalReasonSchema),
    step: Arbitrary.schema(DeployStepError.fields.step),
  },
  ({ keys, reason, step }) => {
    const refusals = [
      new DeployStepError({ keys, reason, step }),
      new PlanRejected({ reason, resources: keys }),
      new RollbackRefused({ reason }),
      new DeployWatchFailed({
        reason,
        receipt: watchReceipt("fixture", "rolled-back"),
      }),
    ];

    for (const refusal of refusals) {
      expect(fenceMessage(refusal.message)?.fix).toContain("`");
    }
  }
);

it.prop(
  "every state copy refusal names what, why, and the fix",
  {
    reason: Arbitrary.schema(StateCopyRefusalSchema),
    stacks: names,
  },
  ({ reason, stacks }) => {
    expect(fenceMessage(refuse(reason, stacks).message)).toBeDefined();
  }
);

it("covers every refusal reason the deploy package can name", () => {
  expect(RefusalReasonSchema.literals.length).toBeGreaterThan(40);
  expect(Schema.is(RefusalReasonSchema)("plan-not-approved")).toBe(true);
});
