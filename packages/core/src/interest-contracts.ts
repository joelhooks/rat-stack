import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { InterestLinkRefused } from "./interest-link-refused.js";
import { InvalidInterestAddress } from "./invalid-interest-address.js";

export const REGISTER_ANSWER =
  "If that address can join the list, a confirmation email is on its way. Unconfirmed addresses expire after 72 hours.";

export const CONFIRM_ANSWER = "You are on the list. Thank you.";

export const registerInterestContract = defineContract("registerInterest", {
  description:
    "Ask for one confirmation email about the tokenmaxx workshop. The answer is the same for every valid address, so the form cannot reveal who signed up. Served over HTTP only; it is not an MCP tool, RPC procedure, or code-mode function because it sends email to any address it is given.",
  failure: InvalidInterestAddress,
  input: Schema.Struct({
    email: Schema.String,
    website: Schema.optional(Schema.String),
  }),
  output: Schema.Struct({ message: Schema.Literal(REGISTER_ANSWER) }),
});

export const confirmInterestContract = defineContract("confirmInterest", {
  description:
    "Count an address as interested once the signed link from its confirmation email is presented. Served over HTTP only.",
  failure: InterestLinkRefused,
  input: Schema.Struct({ token: Schema.String }),
  output: Schema.Struct({ message: Schema.Literal(CONFIRM_ANSWER) }),
});
