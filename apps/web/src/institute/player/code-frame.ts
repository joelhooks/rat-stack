import { Predicate } from "effect";

import type { CodeFrame, CodeLine, CodeToken } from "./section.js";

interface CharacterRange {
  readonly start: number;
  readonly end: number;
}

const visibleTokens = (line: CodeLine, frame: CodeFrame, id: string) =>
  line.partOrder.flatMap((part) => {
    const visibility = frame.state[id]?.parts[part];
    const template = line.parts[part];

    if (Predicate.isString(visibility)) {
      return template?.versions?.[visibility] ?? [];
    }

    return visibility === true ? (template?.tokens ?? []) : [];
  });

export const codeRuns = (
  line: CodeLine,
  frame: CodeFrame,
  id: string,
  bright: readonly CharacterRange[]
) => {
  let from = 0;

  const runs: (CodeToken & {
    readonly bright: boolean;
    readonly start: number;
  })[] = [];

  const boundaries = new Set(
    [...(line.brightBoundaries ?? []), ...bright].flatMap(({ start, end }) => [
      start,
      end,
    ])
  );

  for (const token of visibleTokens(line, frame, id)) {
    const offset = from;
    const to = offset + token.text.length;

    const cuts = [...boundaries]
      .filter((pos) => pos > offset && pos < to)
      .toSorted((a, b) => a - b);

    let start = offset;

    for (const end of [...cuts, to]) {
      const spanStart = start;

      if (end > spanStart) {
        runs.push({
          ...token,
          bright: bright.some(
            (range) => range.start <= spanStart && end <= range.end
          ),
          start: spanStart,
          text: token.text.slice(spanStart - offset, end - offset),
        });
      }

      start = end;
    }

    from = to;
  }

  return runs;
};
