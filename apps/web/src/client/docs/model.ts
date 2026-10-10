import { ReadOutput, SearchOutput } from "@rat-stack/core/contracts";
import { Option, Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

import { AppRoute } from "../../features/route.js";

export const SearchState = defineTaggedUnion({
  Failed: {},
  Idle: {},
  Loaded: { result: SearchOutput },
  Loading: {},
});

export const ReadState = defineTaggedUnion({
  Failed: { message: Schema.String, notFound: Schema.Boolean },
  Idle: {},
  Loaded: { document: ReadOutput },
  Loading: {},
});

export const Model = Schema.Struct({
  generation: Schema.Finite,
  query: Schema.String,
  read: ReadState,
  route: AppRoute,
  search: SearchState,
});

export type AppModel = typeof Model.Type;

export const initialModel: AppModel = {
  generation: 0,
  query: "",
  read: ReadState.Idle(),
  route: AppRoute.Search({ q: Option.none() }),
  search: SearchState.Idle(),
};
