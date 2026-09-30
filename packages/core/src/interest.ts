export { normalizeAddress } from "./interest-address.js";

export {
  CONFIRM_ANSWER,
  REGISTER_ANSWER,
  confirmInterestContract,
  registerInterestContract,
} from "./interest-contracts.js";

export { InterestLinkRefused } from "./interest-link-refused.js";

export { InvalidInterestAddress } from "./invalid-interest-address.js";

export { InterestDirectory, summarize } from "./interest-directory.js";

export type { InterestSummary } from "./interest-directory.js";

export {
  InterestMailer,
  plainTextToHtml,
  postShibaMailerLayer,
  recordingMailerLayer,
  sendsUrl,
} from "./interest-mailer.js";

export type {
  InterestMail,
  MailResult,
  PostShibaSettings,
} from "./interest-mailer.js";

export {
  CONFIRMATION_WINDOW_MS,
  InterestRecordSchema,
  InterestStore,
  RESEND_COOLDOWN_MS,
  interestMachine,
  interestOutcome,
  runInterestMachine,
} from "./interest-machine.js";

export type {
  InterestCommand,
  InterestOutcome,
  InterestRecord,
} from "./interest-machine.js";

export { InterestGate } from "./interest-gate.js";

export { InterestRequest } from "./interest-request.js";

export { digestsMatch, sha256Hex } from "./interest-services.js";

export { InterestTokens } from "./interest-token.js";

export { InvalidInterestToken } from "./invalid-interest-token.js";

export { MailerFailed } from "./mailer-failed.js";

export { RecordedMail } from "./recorded-mail.js";

export type { InterestClaims } from "./interest-token.js";
