import { CafePersonSummary } from "@rat-stack/core/contracts";
import { Schema } from "effect";

import { effectUiHandoff } from "../effect-ui-handoff.js";

export const AllStarsProps = Schema.Struct({
  people: Schema.Array(CafePersonSummary),
});

export const AllStarsHandoff = effectUiHandoff(AllStarsProps);

export const allStarsRootId = "all-stars-effect-ui";

export const allStarsHandoffId = "all-stars-effect-ui-handoff";
