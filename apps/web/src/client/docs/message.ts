import { ReadOutput, SearchOutput } from "@rat-stack/core/contracts";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest } from "foldkit/navigation";
import { Url } from "foldkit/url";

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
