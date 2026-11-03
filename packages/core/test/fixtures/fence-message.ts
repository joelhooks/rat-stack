import { Schema } from "effect";

export interface FenceMessage {
  readonly fix: string;
  readonly what: string;
  readonly why: string;
}

const sentenceBreak = /(?<=[.!?])\s+(?=[A-Z`"'{])/u;

const codeSpan = /`[^`]+`/u;

const finalPunctuation = /[.!?]$/u;

export const fenceMessage = (text: string): FenceMessage | undefined => {
  const [head, fix, ...extra] = text.split(" Fix: ");

  if (head === undefined || fix === undefined || extra.length > 0) {
    return undefined;
  }

  const [what, ...why] = head.split(sentenceBreak);

  if (
    what === undefined ||
    why.length === 0 ||
    !finalPunctuation.test(head) ||
    !finalPunctuation.test(fix) ||
    !codeSpan.test(fix)
  ) {
    return undefined;
  }

  return { fix, what, why: why.join(" ") };
};

export const placeholderValue = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$./<>-]{0,23}$/u)
);
