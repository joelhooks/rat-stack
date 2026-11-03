import { expect, it } from "@effect/vitest";
import { Interaction } from "alchemy/Interaction";
import { Effect, Result, Schema } from "effect";

import {
  credentialRefreshTask,
  withProvisioningFence,
} from "../src/provisioning-fence.js";

const ProvisioningLabel = Schema.Union([
  Schema.TemplateLiteral([
    Schema.Literals(["Deploying", "Resuming", "Updating", "Redeploying"]),
    " Cloudflare State Store '",
    Schema.String,
    "'",
  ]),
  Schema.String,
]).check(Schema.makeFilter((label) => label !== credentialRefreshTask));

const taskUnderFence = (label: string) =>
  Effect.gen(function* runTask() {
    const ran: string[] = [];

    const result = yield* Interaction.pipe(
      Effect.flatMap((interaction) =>
        interaction.task(
          { label },
          Effect.sync(() => ran.push(label))
        )
      ),
      withProvisioningFence,
      Effect.result
    );

    return { ran, result };
  });

it.effect.prop(
  "every task other than the credential refresh is refused before its effect runs",
  { label: ProvisioningLabel },
  ({ label }) =>
    Effect.gen(function* refusesProvisioningTasks() {
      const { ran, result } = yield* taskUnderFence(label);

      expect(ran).toEqual([]);
      expect(Result.isFailure(result) && result.failure.reason).toBe(
        "provisioning-refused"
      );
    })
);

it.effect(
  "the credential refresh runs, because opening an existing store needs it",
  () =>
    Effect.gen(function* runsCredentialRefresh() {
      const { ran, result } = yield* taskUnderFence(credentialRefreshTask).pipe(
        withProvisioningFence
      );

      expect(ran).toEqual([credentialRefreshTask]);
      expect(Result.isSuccess(result)).toBe(true);
    })
);

it.effect.prop(
  "no prompt under the fence confirms an upgrade or a new encryption key",
  { initialValue: Schema.Boolean, message: Schema.String },
  ({ initialValue, message }) =>
    Effect.gen(function* declinesPrompts() {
      const confirmed = yield* Effect.gen(function* confirm() {
        const interaction = yield* Interaction;

        return yield* interaction.prompt
          .confirm({ initialValue, message })
          .pipe(Effect.orElseSucceed(() => false));
      }).pipe(withProvisioningFence);

      expect(confirmed).toBe(false);
    })
);
