import { Approval } from "@rat-stack/capability/approval";
import {
  Interaction,
  layerNonInteractive,
  NonInteractiveTerminal,
} from "alchemy/Interaction";
import { Effect } from "effect";

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
