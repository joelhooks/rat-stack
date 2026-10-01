import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { InterestLinkRefused } from "./interest-link-refused.js";
import { InvalidInterestAddress } from "./invalid-interest-address.js";

export const REGISTER_ANSWER = "Check your email for a link to confirm.";

export const CAPTURE_ANSWER = "Thanks. We'll email you a link to confirm.";

export const CONSENT_LINE =
  'Email me once when the date is set for "how to burn a trillion tokens."';

export const CONSENT_VERSION = "interest-consent-v1";

export const CONFIRM_ANSWER =
  "You'll get one email when the date is set, and that's it.";

export const registerInterestContract = defineContract("registerInterest", {
  description:
    "Ask for one confirmation email about the tokenmaxx workshop. The answer is the same for every valid address, so the form cannot reveal who signed up. Served over HTTP only; it is not an MCP tool, RPC procedure, or code-mode function because it sends email to any address it is given.",
  failure: InvalidInterestAddress,
  input: Schema.Struct({
    email: Schema.String,
    website: Schema.optional(Schema.String),
  }),
  output: Schema.Struct({
    message: Schema.Literals([REGISTER_ANSWER, CAPTURE_ANSWER]),
  }),
});

export const confirmInterestContract = defineContract("confirmInterest", {
  description:
    "Count an address as interested once the signed link from its confirmation email is presented. Served over HTTP only.",
  failure: InterestLinkRefused,
  input: Schema.Struct({ token: Schema.String }),
  output: Schema.Struct({ message: Schema.Literal(CONFIRM_ANSWER) }),
});
