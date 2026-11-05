import { Array, Option, Schema } from "effect";

export const OutlineRange = Schema.Struct({
  current: Schema.String,
  ids: Schema.NonEmptyArray(Schema.String),
});

export type OutlineRangeValue = typeof OutlineRange.Type;

export interface OutlineSection {
  readonly bottom: number;
  readonly id: string;
  readonly landmark: boolean;
  readonly parent: Option.Option<string>;
  readonly top: number;
}

export interface OutlineSpan {
  readonly bottom: number;
  readonly top: number;
}

const overlaps = (section: OutlineSpan, span: OutlineSpan) =>
  section.top < span.bottom && section.bottom > span.top;

const withParents = (
  sections: readonly OutlineSection[],
  visible: readonly OutlineSection[]
) => {
  const wanted = new Set(
    visible.flatMap((section) => [
      section.id,
      ...Option.toArray(section.parent),
    ])
  );

  return sections.filter((section) => wanted.has(section.id));
};

const inView = (
  sections: readonly OutlineSection[],
  viewport: OutlineSpan,
  band: OutlineSpan
) => {
  const landmarks = sections.filter(
    (section) => section.landmark && overlaps(section, band)
  );

  return Array.isReadonlyArrayNonEmpty(landmarks)
    ? landmarks
    : withParents(
        sections,
        sections.filter(
          (section) => !section.landmark && overlaps(section, viewport)
        )
      );
};

export type ScrollDirection = "down" | "still" | "up";

const currentOf = (
  ids: readonly [string, ...string[]],
  previous: Option.Option<OutlineRangeValue>,
  direction: ScrollDirection
) => {
  if (direction === "up") {
    return ids[0];
  }

  if (direction === "down") {
    return Array.lastNonEmpty(ids);
  }

  return Option.match(previous, {
    onNone: () => Array.lastNonEmpty(ids),
    onSome: (range) =>
      ids.includes(range.current) ? range.current : Array.lastNonEmpty(ids),
  });
};

export const outlineRange = (
  sections: readonly OutlineSection[],
  viewport: OutlineSpan,
  band: OutlineSpan,
  previous: Option.Option<OutlineRangeValue>,
  direction: ScrollDirection
): Option.Option<OutlineRangeValue> => {
  const ids = inView(sections, viewport, band).map((section) => section.id);

  return Array.isReadonlyArrayNonEmpty(ids)
    ? Option.some({ current: currentOf(ids, previous, direction), ids })
    : previous;
};

export const sameRange = (left: OutlineRangeValue, right: OutlineRangeValue) =>
  left.current === right.current &&
  left.ids.length === right.ids.length &&
  left.ids.every((id, index) => right.ids[index] === id);
