import { Predicate } from "effect";

import { ReaderNode } from "../src/client/reader-node.js";
import type { ReaderNodeValue } from "../src/client/reader-node.js";

export const normalizedNodes = (
  nodes: readonly ReaderNodeValue[]
): readonly ReaderNodeValue[] => {
  const output: ReaderNodeValue[] = [];

  for (const node of nodes) {
    ReaderNode.$match(node, {
      Element: (element) =>
        output.push(
          ReaderNode.Element({
            ...element,
            attributes: element.attributes.toSorted((left, right) =>
              left.name.localeCompare(right.name)
            ),
            children: normalizedNodes(element.children),
          })
        ),
      Text: ({ value }) => {
        const previous = output.at(-1);

        if (value !== "") {
          if (Predicate.isTagged(previous, "Text")) {
            output[output.length - 1] = ReaderNode.Text({
              value: previous.value + value,
            });
          } else {
            output.push(ReaderNode.Text({ value }));
          }
        }
      },
    });
  }

  return output;
};
