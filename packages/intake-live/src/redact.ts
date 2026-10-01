import type { IntakeAnswers } from "@rat-stack/core/intake";

export const MAX_SCORED_ANSWER_LENGTH = 600;

const PHONE = /\+?\d(?:[\s().-]*\d){6,}/gu;

const EMAIL_MARK = /@|＠|%40/iu;

const LINK_MARK = /:\/\/|[\p{L}\p{N}-]\.\p{L}{2,}/iu;

const redactToken = (token: string) => {
  if (EMAIL_MARK.test(token)) {
    return "[email]";
  }

  return LINK_MARK.test(token) ? "[link]" : token;
};

export const redactAnswer = (answer: string) =>
  answer
    .replaceAll(PHONE, "[phone]")
    .split(/(?<space>\s+)/u)
    .map(redactToken)
    .join("")
    .slice(0, MAX_SCORED_ANSWER_LENGTH);

export const redactAnswers = (answers: IntakeAnswers): IntakeAnswers => {
  const redacted: { -readonly [Key in keyof IntakeAnswers]: string } = {};

  for (const key of ["building", "today", "leaveWith"] as const) {
    const answer = answers[key];

    if (answer !== undefined && answer.trim() !== "") {
      redacted[key] = redactAnswer(answer);
    }
  }

  return redacted;
};
