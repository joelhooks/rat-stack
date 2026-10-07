import { ReadOutput, SearchOutput } from "@rat-stack/core/contracts";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest } from "foldkit/navigation";
import { defineTaggedUnion } from "foldkit/schema";
import { Url } from "foldkit/url";

import { AppRoute } from "../features/route.js";

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

export const Message = defineMessageUnion({
  ChangedUrl: { url: Url },
  ClickedLink: { request: UrlRequest },
  CompletedLoadExternal: {},
  CompletedNavigate: {},
  FailedRead: {
    generation: Schema.Finite,
    message: Schema.String,
    notFound: Schema.Boolean,
  },
  FailedSearch: { generation: Schema.Finite },
  SubmittedSearch: {},
  SucceededRead: { document: ReadOutput, generation: Schema.Finite },
  SucceededSearch: { generation: Schema.Finite, result: SearchOutput },
  UpdatedQuery: { value: Schema.String },
});

export type AppMessage = typeof Message.Type;
