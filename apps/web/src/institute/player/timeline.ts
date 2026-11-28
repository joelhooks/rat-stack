import type { WordTiming } from "./section.js";

export const wordLeadSeconds = 0.18;

export const wordParagraphs = (words: readonly WordTiming[]) => {
  const paragraphs: { readonly word: WordTiming; readonly index: number }[][] =
    [];

  let paragraph: (typeof paragraphs)[number] = [];

  for (const [index, word] of words.entries()) {
    if (paragraph.length === 0 || word.paragraphBreak === true) {
      paragraph = [];
      paragraphs.push(paragraph);
    }

    paragraph.push({ index, word });
  }

  return paragraphs;
};

export const chooseStep = (stepTimes: readonly number[], seconds: number) => {
  for (let index = stepTimes.length - 1; index >= 0; index -= 1) {
    const time = stepTimes[index];

    if (time !== undefined && seconds >= time) {
      return index;
    }
  }

  return 0;
};

export const wordPhase = (
  word: WordTiming,
  seconds: number,
  first: boolean
) => {
  if (
    seconds >= word.start - wordLeadSeconds &&
    seconds <= word.end &&
    !(first && seconds < 0.1)
  ) {
    return "active";
  }

  return seconds > word.end ? "past" : "upcoming";
};
