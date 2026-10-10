export { defineFlag, Flags } from "@rat-stack/core/flags";

export type { Flag, FlagContext } from "@rat-stack/core/flags";

export {
  flagCapabilities,
  getFlag,
  listFlags,
} from "@rat-stack/core/flag-capabilities";

export {
  evaluateFlag,
  FlagRule,
  Percentage,
  subjectBucket,
} from "./evaluate.js";

export type { Rule } from "./evaluate.js";

export { checkFlagExpiry, ExpiredFlags } from "./expiry.js";
