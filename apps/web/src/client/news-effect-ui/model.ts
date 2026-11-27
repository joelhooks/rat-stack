import { CafeNewsItem, CafeNewsSort } from "@rat-stack/core/contracts";
import { Schema } from "effect";

import { NewsProfileLink } from "../cafe/model.js";
import { effectUiHandoff } from "../effect-ui-handoff.js";

export const NewsProps = Schema.Struct({
  items: Schema.Array(CafeNewsItem),
  profiles: Schema.Array(NewsProfileLink),
  sort: CafeNewsSort,
});

export type NewsPageProps = typeof NewsProps.Type;

export const NewsHandoff = effectUiHandoff(NewsProps);

export const newsRootId = "news-effect-ui";

export const newsHandoffId = "news-effect-ui-handoff";
