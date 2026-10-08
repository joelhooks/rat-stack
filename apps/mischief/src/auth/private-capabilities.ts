import { defineContract } from "@rat-stack/capability/contract";
import { toHttpApi } from "@rat-stack/capability/http-api";
import { implement } from "@rat-stack/capability/implement";
import {
  FeedbackCredential,
  FeedbackDevice,
  FeedbackGrant,
  FeedbackRequest,
  LearnUnauthenticated,
} from "@rat-stack/core/learn";
import { FeedbackAuthor } from "@rat-stack/learn/feedback";
import { Schema } from "effect";

const failure = LearnUnauthenticated.annotate({ httpApiStatus: 401 });

const credentialToken = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(4096)
);

const id = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200));

const feedbackAuthorRequestContract = defineContract("feedbackAuthorRequest", {
  description: "Issue a feedback device code over the private service binding.",
  failure,
  input: Schema.Struct({}),
  output: FeedbackRequest,
});

const feedbackAuthorDeviceContract = defineContract("feedbackAuthorDevice", {
  description:
    "Inspect a feedback device grant over the private service binding.",
  failure,
  input: Schema.Struct({ code: id }),
  output: FeedbackDevice,
});

const feedbackAuthorIssueContract = defineContract("feedbackAuthorIssue", {
  description: "Issue a feedback-only credential from an approved grant.",
  failure,
  input: FeedbackGrant,
  output: credentialToken,
});

const feedbackAuthorCredentialContract = defineContract(
  "feedbackAuthorCredential",
  {
    description: "Validate feedback authority for one capability.",
    failure: Schema.Never,
    input: Schema.Struct({ capability: Schema.String, token: credentialToken }),
    output: FeedbackCredential,
  }
);

const feedbackAuthorSaveContract = defineContract("feedbackAuthorSave", {
  description:
    "Store person-owned feedback from the trusted public composition.",
  failure: Schema.Never,
  input: Schema.Struct({
    cardId: id,
    feedback: Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(2000)
    ),
    personId: id,
  }),
  output: Schema.Struct({ id: Schema.String }),
});

export const feedbackPrivateCapabilities = [
  implement(feedbackAuthorRequestContract, () =>
    FeedbackAuthor.use((author) => author.request)
  ),
  implement(feedbackAuthorDeviceContract, ({ code }) =>
    FeedbackAuthor.use((author) => author.inspectDevice(code))
  ),
  implement(feedbackAuthorIssueContract, (grant) =>
    FeedbackAuthor.use((author) => author.issue(grant))
  ),
  implement(feedbackAuthorCredentialContract, ({ capability, token }) =>
    FeedbackAuthor.use((author) => author.inspectCredential(token, capability))
  ),
  implement(feedbackAuthorSaveContract, ({ cardId, feedback, personId }) =>
    FeedbackAuthor.use((author) => author.save(personId, cardId, feedback))
  ),
] as const;

export const feedbackPrivateApi = toHttpApi(
  "LearnFeedbackAuth",
  feedbackPrivateCapabilities,
  { prefix: "/private" }
);
