import type {
  ConceptProgress,
  LearnDepth,
  LearnEvent,
  Progress,
} from "@rat-stack/core/learn";
import { newConcept } from "@rat-stack/core/learn";

export const LONG_GAP_MS = 7 * 24 * 60 * 60 * 1000;

export const DECAY_GAP_MS = 90 * 24 * 60 * 60 * 1000;

const newest = (left: number | null, right: number | null) => {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return Math.max(left, right);
};

const greaterFamiliarity = (
  left: ConceptProgress["familiarity"],
  right: ConceptProgress["familiarity"]
) => (left >= right ? left : right);

const advanceFamiliarity = (
  rank: ConceptProgress["familiarity"]
): ConceptProgress["familiarity"] => {
  if (rank === 0) {
    return 1;
  }

  if (rank === 1) {
    return 2;
  }

  return 3;
};

export const isDecaying = (progress: ConceptProgress, at: number) =>
  progress.familiarity > 0 &&
  at - Math.max(progress.lastShownAt ?? 0, progress.lastPracticedAt ?? 0) >=
    DECAY_GAP_MS;

export const explanationDepth = (
  progress: ConceptProgress,
  at: number,
  asked = false
): LearnDepth | null => {
  if (progress.dismissed) {
    return null;
  }

  if (asked) {
    return progress.familiarity === 0 ? "walkthrough" : "paragraph";
  }

  if (progress.familiarity === 0) {
    return "walkthrough";
  }

  const gap = at - (progress.lastShownAt ?? 0);

  if (isDecaying(progress, at)) {
    return progress.familiarity === 1 ? "paragraph" : "line";
  }

  if (progress.familiarity === 1) {
    return gap >= LONG_GAP_MS ? "paragraph" : "line";
  }

  if (progress.familiarity === 2 && gap >= LONG_GAP_MS) {
    return "line";
  }

  return null;
};

export const foldConcept = (
  progress: ConceptProgress,
  event: LearnEvent
): ConceptProgress => {
  if (event.kind === "shown") {
    return {
      ...progress,
      familiarity: progress.familiarity === 0 ? 1 : progress.familiarity,
      lastShownAt: newest(progress.lastShownAt, event.at),
    };
  }

  if (event.kind === "dismissed") {
    return { ...progress, dismissed: true };
  }

  const familiarity = advanceFamiliarity(progress.familiarity);

  return {
    ...progress,
    familiarity,
    lastPracticedAt: newest(progress.lastPracticedAt, event.at),
  };
};

export const mergeProgress = (left: Progress, right: Progress): Progress => {
  const byId = new Map<string, ConceptProgress>();

  for (const concept of [...left.concepts, ...right.concepts]) {
    const previous = byId.get(concept.id) ?? newConcept(concept.id);
    byId.set(concept.id, {
      dismissed: previous.dismissed || concept.dismissed,
      familiarity: greaterFamiliarity(
        previous.familiarity,
        concept.familiarity
      ),
      id: concept.id,
      lastPracticedAt: newest(
        previous.lastPracticedAt,
        concept.lastPracticedAt
      ),
      lastShownAt: newest(previous.lastShownAt, concept.lastShownAt),
    });
  }

  return {
    concepts: [...byId.values()].toSorted((a, b) => a.id.localeCompare(b.id)),
    version: 1,
  };
};
