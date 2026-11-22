import type { Card, LearnDepth, LearnSelection } from "@rat-stack/core/learn";
import { Struct } from "effect";

export const presentCard = (
  card: Card,
  depth: LearnDepth
): LearnSelection["cards"][number] => {
  if (depth === "walkthrough") {
    return { card, depth };
  }

  if (depth === "paragraph") {
    return { card: Struct.omit(card, ["diagram", "snippet"]), depth };
  }

  const line = Struct.pick(card, [
    "claim",
    "id",
    "kind",
    "references",
    "routePath",
    "version",
  ]);

  return {
    card:
      card.plain === undefined
        ? { ...line, summary: card.summary }
        : { ...line, plain: card.plain },
    depth,
  };
};
