import {
  SetupHelpAccess,
  SetupHelpGuide,
  unconfiguredHelp,
} from "@rat-stack/core/tokenmaxx-help";
import type { SetupHelpSettings } from "@rat-stack/core/tokenmaxx-help";
import { Effect, Layer } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { memoryHelpDesk } from "../../../../packages/core/test/fixtures/help-desk-memory.js";
import { helpGuideForGeneration } from "../../src/workshop-help/guide.js";

const memoryDesk = Layer.unwrap(
  memoryHelpDesk.pipe(Effect.map((desk) => desk.layer))
);

export const workshopHelpForTest = (
  generation: string,
  settings: SetupHelpSettings = unconfiguredHelp
) =>
  Layer.mergeAll(
    memoryDesk,
    SetupHelpAccess.configLayer(settings),
    helpGuideForGeneration(generation),
    SecureRandom.layerWebCrypto
  );

export const workshopHelpWithoutAssets = Layer.mergeAll(
  memoryDesk,
  SetupHelpAccess.configLayer(unconfiguredHelp),
  SetupHelpGuide.layer([]),
  SecureRandom.layerWebCrypto
);
