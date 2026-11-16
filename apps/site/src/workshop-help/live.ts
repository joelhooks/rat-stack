import {
  readSetupHelpSettings,
  SetupHelpAccess,
} from "@rat-stack/core/tokenmaxx-help";
import type { SetupHelpSettings } from "@rat-stack/core/tokenmaxx-help";
import { Effect, Layer } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { HELP_DESK_INSTANCE, helpDeskLayer } from "./desk.js";
import type { HelpDeskStub } from "./desk.js";
import { helpGuideLayer } from "./guide.js";
import { WorkshopHelpDesk } from "./help-desk-durable-object.js";

export const workshopHelpLayer = (
  desk: () => HelpDeskStub,
  access: SetupHelpSettings
) =>
  Layer.mergeAll(
    helpDeskLayer(desk),
    SetupHelpAccess.configLayer(access),
    helpGuideLayer,
    SecureRandom.layerWebCrypto
  );

export type WorkshopHelpServices = Layer.Success<
  ReturnType<typeof workshopHelpLayer>
>;

export const workshopHelpLive = Layer.unwrap(
  Effect.gen(function* bindWorkshopHelp() {
    const desks = yield* WorkshopHelpDesk;
    const access = yield* readSetupHelpSettings;

    return workshopHelpLayer(() => desks.getByName(HELP_DESK_INSTANCE), access);
  })
);
