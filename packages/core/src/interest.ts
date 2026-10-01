export { normalizeAddress } from "./interest-address.js";

export {
  CAPTURE_ANSWER,
  CONFIRM_ANSWER,
  CONSENT_LINE,
  CONSENT_VERSION,
  REGISTER_ANSWER,
  confirmInterestContract,
  registerInterestContract,
} from "./interest-contracts.js";

export { InterestLinkRefused } from "./interest-link-refused.js";

export { InvalidInterestAddress } from "./invalid-interest-address.js";

export {
  InterestDirectory,
  removeRecords,
  summarize,
} from "./interest-directory.js";

export type {
  InterestSummary,
  RemoveCounts,
  RemoveSelector,
} from "./interest-directory.js";

export { InterestMailer, recordingMailerLayer } from "./interest-mailer.js";

export type { InterestMail, MailResult } from "./interest-mailer.js";

export {
  CONFIRMATION_WINDOW_MS,
  CaptureEvidenceSchema,
  InterestRecordSchema,
  InterestStore,
  RESEND_COOLDOWN_MS,
  interestMachine,
  interestOutcome,
  runInterestMachine,
} from "./interest-machine.js";

export type {
  InterestCommand,
  CaptureRequest,
  InterestOutcome,
  InterestRecord,
} from "./interest-machine.js";

export { SubscriberIntake } from "./interest-intake.js";

export type { IntakeRequest, IntakeResult } from "./interest-intake.js";

export { SubscriberConfirm } from "./interest-confirm-port.js";

export type { ConfirmState } from "./interest-confirm-port.js";

export { normalizeClientIp } from "./interest-ip.js";

export { InterestGate } from "./interest-gate.js";

export { InterestMode } from "./interest-mode.js";

export type { InterestModeName } from "./interest-mode.js";

export { InterestRequest } from "./interest-request.js";

export { digestsMatch, sha256Hex } from "./interest-services.js";

export { InterestTokens } from "./interest-token.js";

export { InvalidInterestToken } from "./invalid-interest-token.js";

export { MailerFailed } from "./mailer-failed.js";

export { RecordedMail } from "./recorded-mail.js";

export type { InterestClaims } from "./interest-token.js";
