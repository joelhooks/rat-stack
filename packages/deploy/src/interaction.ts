import { Approval } from "@rat-stack/capability/approval";
import type { ApprovalService } from "@rat-stack/capability/approval";
import {
  Interaction,
  layerNonInteractive,
  NonInteractiveTerminal,
} from "alchemy/Interaction";
import { Context, Effect } from "effect";

export const callApprovalContext = <R>(
  services: Context.Context<R>,
  approval: ApprovalService
) => Context.add(services, Approval, approval);

export const capabilityInteraction = Effect.gen(
  function* capabilityInteraction() {
    const approval = yield* Approval;

    const unattended = yield* Interaction.pipe(
      Effect.provide(layerNonInteractive())
    );

    return Interaction.of({
      ...unattended,
      prompt: {
        ...unattended.prompt,
        confirm: (options) =>
          approval
            .approve("deployProd", {
              message: options.message,
              operation: "alchemy-confirm",
            })
            .pipe(
              Effect.as(true),
              Effect.mapError(
                () =>
                  // oxlint-disable-next-line anti-slop-effect/require-cause-when-narrowing -- Alchemy renders this operator-facing approval error; upstream failures must not expose untrusted prompt details.
                  new NonInteractiveTerminal({
                    message:
                      "Alchemy confirmation requires approval through deployProd. Supply approval at the capability boundary.",
                    operation: "confirmation",
                  })
              )
            ),
      },
    });
  }
);
