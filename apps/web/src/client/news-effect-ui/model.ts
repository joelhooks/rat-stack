import { CafeNewsItem, CafeNewsSort } from "@rat-stack/core/contracts";
import { Schema } from "effect";

import { effectUiHandoff } from "../effect-ui-handoff.js";

const NewsProfileLink = Schema.Struct({
  name: Schema.String,
  route: Schema.String,
  url: Schema.String,
});

export const NewsProps = Schema.Struct({
  items: Schema.Array(CafeNewsItem),
  profiles: Schema.Array(NewsProfileLink),
  sort: CafeNewsSort,
});

export type NewsPageProps = typeof NewsProps.Type;

export const NewsHandoff = effectUiHandoff(NewsProps);

export const newsRootId = "news-effect-ui";

export const newsHandoffId = "news-effect-ui-handoff";
