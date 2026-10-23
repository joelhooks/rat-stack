import { Layer, Option } from "effect";
import type { Duration } from "effect";
import { FetchHttpClient } from "effect/http";

import { drovrAgentIntakeLayer } from "./drovr-agent-intake.js";
import { drovrConfirmLayer } from "./drovr-confirm.js";
import type { ConfirmSettings } from "./drovr-confirm.js";
import { DrovrIntakeTimeout, drovrIntakeLayer } from "./drovr-intake.js";
import type { IntakeSettings } from "./drovr-intake.js";
import { postShibaMailerLayer } from "./postshiba.js";
import type { PostShibaSettings } from "./postshiba.js";

export interface SubscriberDeliverySettings {
  readonly agentIntake?: IntakeSettings;
  readonly confirm: ConfirmSettings;
  readonly intake: IntakeSettings;
  readonly intakeTimeout?: Duration.Duration | undefined;
  readonly mailer: PostShibaSettings;
}

export const subscriberDeliveryLayer = (settings: SubscriberDeliverySettings) =>
  Layer.mergeAll(
    drovrAgentIntakeLayer(
      settings.agentIntake ?? { credential: Option.none(), url: Option.none() }
    ).pipe(Layer.provide(drovrIntakeLayer(settings.intake))),
    drovrConfirmLayer(settings.confirm),
    postShibaMailerLayer(settings.mailer)
  ).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      settings.intakeTimeout === undefined
        ? Layer.empty
        : Layer.succeed(DrovrIntakeTimeout, settings.intakeTimeout)
    )
  );
