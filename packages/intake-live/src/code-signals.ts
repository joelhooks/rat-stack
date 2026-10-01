import type { AbuseInput } from "@rat-stack/core/intake";

export const MAX_ANSWER_LENGTH = 4000;

export const INSTANT_TICKET_MILLIS = 2000;

export interface Signal {
  readonly hold: boolean;
  readonly name: string;
  readonly score: number;
}

const answersOf = (input: AbuseInput) =>
  [
    input.answers.building,
    input.answers.today,
    input.answers.leaveWith,
  ].flatMap((answer) => {
    const trimmed = answer?.trim() ?? "";

    return trimmed === "" ? [] : [trimmed];
  });

const isJunk = (answer: string) => {
  if (answer.length < 20) {
    return false;
  }

  const letters = answer.replaceAll(/[^\p{L}]/gu, "").length;
  const counts = new Map<string, number>();

  for (const character of answer) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  const mostRepeated = Math.max(...counts.values());

  return letters / answer.length < 0.4 || mostRepeated / answer.length > 0.6;
};

export const codeSignals = (
  input: AbuseInput,
  now: number
): readonly Signal[] => {
  const answers = answersOf(input);
  const signals: Signal[] = [];

  if (answers.length === 0) {
    signals.push({ hold: false, name: "no_answers", score: 0.3 });
  }

  if (now - input.ticket.mintedAt < INSTANT_TICKET_MILLIS) {
    signals.push({ hold: false, name: "ticket_instant", score: 0.2 });
  }

  if (answers.some((answer) => answer.length > MAX_ANSWER_LENGTH)) {
    signals.push({ hold: true, name: "answer_overlong", score: 0.8 });
  }

  if (answers.some(isJunk)) {
    signals.push({ hold: true, name: "answer_junk", score: 0.8 });
  }

  return signals;
};
