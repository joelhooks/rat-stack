import { describe, expect, it } from "@effect/vitest";
import { Array, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { outlineRange } from "../src/client/reader/outline-range.js";
import type {
  OutlineRangeValue,
  OutlineSection,
  ScrollDirection,
} from "../src/client/reader/outline-range.js";

const between = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ maximum, minimum })));

const prose = Arbitrary.array(
  Arbitrary.all([between(20, 900), Arbitrary.schema(Schema.Boolean)]),
  { maxLength: 10, minLength: 1 }
);

const landmarks = Arbitrary.array(between(80, 600), {
  maxLength: 2,
  minLength: 0,
});

const scrolls = Arbitrary.array(between(0, 8000), {
  maxLength: 30,
  minLength: 1,
});

interface Layout {
  readonly id: string;
  readonly landmark: boolean;
  readonly level: 2 | 3;
  readonly parent: Option.Option<string>;
  readonly start: number;
  readonly end: number;
}

const toolbar = 48;

const pageLayout = (
  sections: readonly (readonly [number, boolean])[],
  ends: readonly number[]
): readonly Layout[] => {
  const laid: Layout[] = [];
  let parent: Option.Option<string> = Option.none();
  let cursor = 200;

  for (const [index, [height, nested]] of sections.entries()) {
    const level = nested && Option.isSome(parent) ? 3 : 2;
    const id = `heading-${index}`;

    laid.push({
      end: cursor + height,
      id,
      landmark: false,
      level,
      parent: level === 3 ? parent : Option.none(),
      start: cursor,
    });
    cursor += height;

    if (level === 2) {
      parent = Option.some(id);
    }
  }

  for (const [index, height] of ends.entries()) {
    cursor += 40;
    laid.push({
      end: cursor + height,
      id: `landmark-${index}`,
      landmark: true,
      level: 2,
      parent: Option.none(),
      start: cursor,
    });
    cursor += height;
  }

  return laid;
};

const atScroll = (
  layout: readonly Layout[],
  scrollY: number
): readonly OutlineSection[] =>
  layout.map((entry) => ({
    bottom: entry.end - scrollY,
    id: entry.id,
    landmark: entry.landmark,
    parent: entry.parent,
    top: entry.start - scrollY,
  }));

const viewportHeight = 900;

const viewport = { bottom: viewportHeight, top: toolbar };

const band = { bottom: viewportHeight * 0.45, top: viewportHeight * 0.2 };

const directionOf = (from: number, to: number): ScrollDirection => {
  if (to > from) {
    return "down";
  }

  return to < from ? "up" : "still";
};

interface Step {
  readonly direction: ScrollDirection;
  readonly range: Option.Option<OutlineRangeValue>;
  readonly scrollY: number;
}

const walk = (layout: readonly Layout[], positions: readonly number[]) => {
  const steps: Step[] = [];

  for (const scrollY of positions) {
    const previous = steps.at(-1);
    const direction = directionOf(previous?.scrollY ?? 0, scrollY);

    steps.push({
      direction,
      range: outlineRange(
        atScroll(layout, scrollY),
        viewport,
        band,
        previous?.range ?? Option.none(),
        direction
      ),
      scrollY,
    });
  }

  return steps;
};

const overlaps = (
  section: OutlineSection,
  span: { readonly bottom: number; readonly top: number }
) => section.top < span.bottom && section.bottom > span.top;

describe("outline range", () => {
  it.prop(
    "once lit, the outline never goes blank while scrolling",
    { ends: landmarks, positions: scrolls, sections: prose },
    ({ ends, positions, sections }) => {
      const steps = walk(pageLayout(sections, ends), positions);
      const firstLit = steps.findIndex((step) => Option.isSome(step.range));

      expect(
        firstLit === -1
          ? []
          : steps.slice(firstLit).filter((step) => Option.isNone(step.range))
      ).toStrictEqual([]);
    }
  );

  it.prop(
    "a landmark in the band outranks every heading, and an h3 in view brings its h2",
    { ends: landmarks, positions: scrolls, sections: prose },
    ({ ends, positions, sections }) => {
      const layout = pageLayout(sections, ends);

      for (const step of walk(layout, positions)) {
        const now = atScroll(layout, step.scrollY);

        const inBand = now.filter(
          (section) => section.landmark && overlaps(section, band)
        );

        const ids = Option.match(step.range, {
          onNone: (): readonly string[] => [],
          onSome: (range) => [...range.ids],
        });

        if (Array.isReadonlyArrayNonEmpty(inBand)) {
          expect(ids).toStrictEqual(inBand.map((section) => section.id));
        } else {
          for (const section of now) {
            if (
              ids.includes(section.id) &&
              Option.isSome(section.parent) &&
              !section.landmark
            ) {
              expect(ids).toContain(section.parent.value);
            }
          }
        }
      }
    }
  );

  it.prop(
    "scrolling down makes the last row current and scrolling up the first",
    { ends: landmarks, positions: scrolls, sections: prose },
    ({ ends, positions, sections }) => {
      const steps = walk(pageLayout(sections, ends), positions);

      for (const [index, step] of steps.entries()) {
        const previous = steps.at(index - 1)?.range ?? Option.none();

        const moved =
          index > 0 &&
          Option.isSome(step.range) &&
          !(Option.isSome(previous) && previous.value === step.range.value);

        if (moved && step.direction === "down") {
          expect(step.range.value.current).toBe(
            Array.lastNonEmpty(step.range.value.ids)
          );
        }

        if (moved && step.direction === "up") {
          expect(step.range.value.current).toBe(step.range.value.ids[0]);
        }
      }
    }
  );
});
