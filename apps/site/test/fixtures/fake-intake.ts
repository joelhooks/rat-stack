import { Effect } from "effect";

import { scriptedIntakeLayer } from "../../../../packages/core/test/fixtures/scripted-intake.js";

export const acceptedIntakeLayer = scriptedIntakeLayer({
  submit: () => Effect.succeed({ kind: "accepted" }),
});
