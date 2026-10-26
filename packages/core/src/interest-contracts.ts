import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { InterestLinkRefused } from "./interest-link-refused.js";

export const CONSENT_LINE =
  'Email me once when the date is set for "how to burn a trillion tokens."';

export const CONSENT_VERSION = "interest-consent-v1";

export const CONFIRM_ANSWER =
  "You'll get one email when the date is set, and that's it.";

export const confirmInterestContract = defineContract("confirmInterest", {
  description:
    "Count an address as interested once the signed link from its confirmation email is presented. Served over HTTP only.",
  failure: InterestLinkRefused,
  input: Schema.Struct({ token: Schema.String }),
  output: Schema.Struct({ message: Schema.Literal(CONFIRM_ANSWER) }),
});
