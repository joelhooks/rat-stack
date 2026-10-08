type LeafType =
  | "PunctuationNode"
  | "SymbolNode"
  | "TextNode"
  | "WhiteSpaceNode";

type ParentType = "ParagraphNode" | "RootNode" | "SentenceNode" | "WordNode";

interface LatinLeaf {
  readonly type: LeafType;
  value: string;
}

interface LatinParent {
  readonly type: ParentType;
  children: LatinNode[];
}

type LatinNode = LatinLeaf | LatinParent;

type Modifier = (
  child: LatinNode,
  index: number,
  parent: LatinParent
) => number;

const whiteSpace =
  /[\t-\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/u;

const punctuation = /[^#%&*@\P{P}]/u;

const wordCharacter = /[\p{L}\p{M}\p{N}]/u;

const surrogate = /[\uD800-\uDFFF]/u;

const newLine = /^[ \t]*(?:(?:\r?\n|\r)[\t ]*)+$/u;

const newLineMulti = /^[ \t]*(?:(?:\r?\n|\r)[\t ]*){2,}$/u;

const terminalMarker = /^[!.?\u2026\u203D]+$/u;

const wordSymbolInner =
  /^(?:[&'\-.:=?@\u00AD\u00B7\u2010\u2011\u2019\u2027]|_+)$/u;

const affixSymbol =
  /^(?:(?<closer>\p{Pe})\k<closer>*|(?<quote>["'\u00BB\u2019\u201D\u203A\u2E03\u2E05\u2E0A\u2E0D\u2E1D\u2E21])\k<quote>*|(?<terminal>[!.?\u2026\u203D])\k<terminal>*)$/u;

const numerical = /^\p{N}+$/u;

const digitStart = /^\d/u;

const lowerInitial = /^\p{Ll}/u;

const abbreviationPrefix =
  /^(?:\d{1,3}|[a-z]|al|ca|cap|cca|cent|cf|cit|con|cp|cwt|ead|etc|ff|fl|ibid|id|nem|op|pro|seq|sic|stat|tem|viz)$/u;

const decade = /^\d\ds$/u;

const threeFullStops = /^\.{3,}$/u;

const fullStops = /^\.+$/u;

const openingQuotes = new Map([
  ['"', "\u201C"],
  ["'", "\u2018"],
]);

const closingQuotes = new Map([
  ['"', "\u201D"],
  ["'", "\u2019"],
]);

const isParent = (node: LatinNode | undefined): node is LatinParent =>
  node !== undefined && "children" in node;

const isMark = (node: LatinNode | undefined): node is LatinLeaf =>
  node?.type === "PunctuationNode" || node?.type === "SymbolNode";

const textOf = (node: LatinNode | undefined): string => {
  if (node === undefined) {
    return "";
  }

  return isParent(node) ? node.children.map(textOf).join("") : node.value;
};

const modifyChildren =
  (modifier: Modifier) =>
  (parent: LatinParent): void => {
    const { children } = parent;
    let index = 0;

    while (index < children.length) {
      const child = children[index];

      const result =
        child === undefined ? undefined : modifier(child, index, parent);

      index = result === undefined ? index + 1 : Math.max(result, 0);
    }
  };

const visitChildren =
  (visitor: (child: LatinNode, index: number, parent: LatinParent) => void) =>
  (parent: LatinParent): void => {
    const { children } = parent;
    let index = 0;

    while (index < children.length) {
      const child = children[index];

      if (child !== undefined) {
        visitor(child, index, parent);
      }

      index += 1;
    }
  };

const characterKind = (character: string) => {
  if (whiteSpace.test(character)) {
    return "WhiteSpace";
  }

  if (punctuation.test(character)) {
    return "Punctuation";
  }

  return wordCharacter.test(character) ? "Word" : "Symbol";
};

type Kind = ReturnType<typeof characterKind>;

const tokenNode = (kind: Kind, value: string): LatinNode => {
  if (kind === "Word") {
    return { children: [{ type: "TextNode", value }], type: "WordNode" };
  }

  return { type: `${kind}Node`, value };
};

const tokenize = (value: string): LatinNode[] => {
  const tokens: LatinNode[] = [];
  let left: Kind | undefined;
  let previous = "";
  let queue = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);
    const right = characterKind(character);

    if (
      left === right &&
      (left === "Word" ||
        left === "WhiteSpace" ||
        character === previous ||
        surrogate.test(character))
    ) {
      queue += character;
    } else {
      if (queue !== "" && left !== undefined) {
        tokens.push(tokenNode(left, queue));
      }

      queue = character;
    }

    previous = character;
    left = right;
  }

  if (queue !== "" && left !== undefined) {
    tokens.push(tokenNode(left, queue));
  }

  return tokens;
};

const splitAt = (
  node: LatinParent,
  delimiterType: LeafType,
  delimiter: RegExp,
  type: ParentType
): LatinParent[] => {
  const groups: LatinParent[] = [];
  let start = 0;

  for (const [index, token] of node.children.entries()) {
    if (
      index === node.children.length - 1 ||
      (token.type === delimiterType && delimiter.test(textOf(token)))
    ) {
      groups.push({ children: node.children.slice(start, index + 1), type });
      start = index + 1;
    }
  }

  return groups;
};

const mergeInitialWordSymbol: Modifier = (child, index, parent) => {
  if (!isMark(child) || child.value !== "&") {
    return index + 1;
  }

  const { children } = parent;
  const next = children[index + 1];

  if (
    (index !== 0 && children[index - 1]?.type === "WordNode") ||
    next?.type !== "WordNode" ||
    !isParent(next)
  ) {
    return index + 1;
  }

  children.splice(index, 1);
  next.children.unshift(child);

  return index - 1;
};

const mergeFinalWordSymbol: Modifier = (child, index, parent) => {
  if (index === 0 || !isMark(child) || child.value !== "-") {
    return index + 1;
  }

  const { children } = parent;
  const previous = children[index - 1];
  const next = children[index + 1];

  if (next?.type !== "WordNode" && isParent(previous)) {
    if (previous.type !== "WordNode") {
      return index + 1;
    }

    children.splice(index, 1);
    previous.children.push(child);

    return index;
  }

  return index + 1;
};

const mergeInnerWordSymbol: Modifier = (child, index, parent) => {
  if (index === 0 || !isMark(child)) {
    return index + 1;
  }

  const siblings = parent.children;
  const previous = siblings[index - 1];

  if (previous?.type !== "WordNode" || !isParent(previous)) {
    return index + 1;
  }

  let position = index - 1;
  const tokens: LatinNode[] = [];
  let queue: LatinNode[] = [];

  for (;;) {
    position += 1;
    const sibling = siblings[position];

    if (sibling === undefined) {
      break;
    }

    if (sibling.type === "WordNode" && isParent(sibling)) {
      tokens.push(...queue, ...sibling.children);
      queue = [];
    } else if (isMark(sibling) && wordSymbolInner.test(sibling.value)) {
      queue.push(sibling);
    } else {
      break;
    }
  }

  if (tokens.length === 0) {
    return index + 1;
  }

  position -= queue.length;
  siblings.splice(index, position - index);
  previous.children = [...previous.children, ...tokens];

  return index;
};

const mergeInnerWordSlash: Modifier = (child, index, parent) => {
  const siblings = parent.children;
  const previous = siblings[index - 1];
  const next = siblings[index + 1];

  if (
    previous?.type !== "WordNode" ||
    !isParent(previous) ||
    !isMark(child) ||
    child.value !== "/"
  ) {
    return index + 1;
  }

  const previousValue = textOf(previous);
  let queue: LatinNode[] = [child];
  let count = 1;
  let nextValue: string | undefined;

  if (next?.type === "WordNode" && isParent(next)) {
    nextValue = textOf(next);
    queue = [...queue, ...next.children];
    count += 1;
  }

  if (
    previousValue.length < 3 &&
    (nextValue === undefined || nextValue === "" || nextValue.length < 3)
  ) {
    previous.children = [...previous.children, ...queue];
    siblings.splice(index, count);

    return index;
  }

  return index + 1;
};

const mergeInitialisms: Modifier = (child, index, parent) => {
  if (index === 0 || textOf(child) !== ".") {
    return index + 1;
  }

  const siblings = parent.children;
  const previous = siblings[index - 1];

  if (previous?.type !== "WordNode" || !isParent(previous)) {
    return index + 1;
  }

  const { children } = previous;
  const { length } = children;

  if (length === 1 || length % 2 === 0) {
    return index + 1;
  }

  let position = length;
  let allDigits = true;

  for (;;) {
    position -= 1;
    const other = children[position];

    if (other === undefined) {
      break;
    }

    const value = textOf(other);

    if (position % 2 === 0) {
      if (value.length > 1) {
        return index + 1;
      }

      if (!numerical.test(value)) {
        allDigits = false;
      }
    } else if (value !== ".") {
      if (position < length - 2) {
        break;
      }

      return index + 1;
    }
  }

  if (allDigits) {
    return index + 1;
  }

  siblings.splice(index, 1);
  children.push(child);

  return index;
};

const mergeWords: Modifier = (child, index, parent) => {
  const siblings = parent.children;
  const next = siblings[index + 1];

  if (
    child.type === "WordNode" &&
    isParent(child) &&
    next?.type === "WordNode" &&
    isParent(next)
  ) {
    siblings.splice(index + 1, 1);
    child.children = [...child.children, ...next.children];

    return index;
  }

  return index + 1;
};

const mergeNonWordSentences: Modifier = (child, index, parent) => {
  if (!isParent(child)) {
    return index + 1;
  }

  if (child.children.some((node) => node.type === "WordNode")) {
    return index + 1;
  }

  const previous = parent.children[index - 1];

  if (isParent(previous)) {
    previous.children = [...previous.children, ...child.children];
    parent.children.splice(index, 1);

    return index;
  }

  const next = parent.children[index + 1];

  if (isParent(next)) {
    next.children = [...child.children, ...next.children];
    parent.children.splice(index, 1);
  }

  return index + 1;
};

const mergeAffixSymbol: Modifier = (child, index, parent) => {
  if (!isParent(child) || child.children.length === 0 || index === 0) {
    return index + 1;
  }

  const [first] = child.children;
  const previous = parent.children[index - 1];

  if (isMark(first) && affixSymbol.test(first.value) && isParent(previous)) {
    child.children.shift();
    previous.children.push(first);

    return index - 1;
  }

  return index + 1;
};

const mergeInitialLowerCaseLetterSentences: Modifier = (
  child,
  index,
  parent
) => {
  if (!isParent(child) || child.children.length === 0 || index === 0) {
    return index + 1;
  }

  for (const node of child.children) {
    if (node.type === "WordNode") {
      if (!lowerInitial.test(textOf(node))) {
        return index + 1;
      }

      const previous = parent.children[index - 1];

      if (!isParent(previous)) {
        return index + 1;
      }

      previous.children = [...previous.children, ...child.children];
      parent.children.splice(index, 1);

      return index;
    }

    if (isMark(node)) {
      return index + 1;
    }
  }

  return index + 1;
};

const mergeInitialDigitSentences: Modifier = (child, index, parent) => {
  const previous = parent.children[index - 1];
  const head = isParent(child) ? child.children[0] : undefined;

  if (
    isParent(previous) &&
    isParent(child) &&
    head?.type === "WordNode" &&
    digitStart.test(textOf(head))
  ) {
    previous.children = [...previous.children, ...child.children];
    parent.children.splice(index, 1);

    return index;
  }

  return index + 1;
};

const mergePrefixExceptions: Modifier = (child, index, parent) => {
  if (!isParent(child) || child.children.length <= 1) {
    return index + 1;
  }

  const { children } = child;
  const period = children.at(-1);

  if (textOf(period) !== ".") {
    return index + 1;
  }

  const node = children.at(-2);

  if (
    node?.type !== "WordNode" ||
    !isParent(node) ||
    period === undefined ||
    !abbreviationPrefix.test(textOf(node).toLowerCase())
  ) {
    return index + 1;
  }

  node.children.push(period);
  children.pop();
  const next = parent.children[index + 1];

  if (isParent(next)) {
    child.children = [...children, ...next.children];
    parent.children.splice(index + 1, 1);

    return index - 1;
  }

  return index + 1;
};

const mergeAffixExceptions: Modifier = (child, index, parent) => {
  if (!isParent(child) || child.children.length === 0 || index === 0) {
    return index + 1;
  }

  for (const node of child.children) {
    if (node.type === "WordNode") {
      return index + 1;
    }

    if (isMark(node)) {
      if (node.value !== "," && node.value !== ";") {
        return index + 1;
      }

      const previous = parent.children[index - 1];

      if (!isParent(previous)) {
        return index + 1;
      }

      previous.children = [...previous.children, ...child.children];
      parent.children.splice(index, 1);

      return index;
    }
  }

  return index + 1;
};

const mergeRemainingFullStops = visitChildren((child) => {
  if (!isParent(child)) {
    return;
  }

  const { children } = child;
  let position = children.length;
  let foundDelimiter = false;

  for (;;) {
    position -= 1;
    const grandchild = children[position];

    if (grandchild === undefined) {
      break;
    }

    if (!isMark(grandchild)) {
      if (grandchild.type === "WordNode") {
        foundDelimiter = true;
      }

      continue;
    }

    if (!terminalMarker.test(grandchild.value)) {
      continue;
    }

    if (!foundDelimiter) {
      foundDelimiter = true;

      continue;
    }

    if (grandchild.value !== ".") {
      continue;
    }

    const previous = children[position - 1];
    const next = children[position + 1];

    if (previous?.type === "WordNode" && isParent(previous)) {
      const nextNext = children[position + 2];

      if (next?.type === "WhiteSpaceNode" && textOf(nextNext) === ".") {
        continue;
      }

      children.splice(position, 1);
      previous.children.push(grandchild);
      position -= 1;
    } else if (next?.type === "WordNode" && isParent(next)) {
      children.splice(position, 1);
      next.children.unshift(grandchild);
    }
  }
});

const makeInitialWhiteSpaceSiblings = visitChildren((child, index, parent) => {
  if (!isParent(child)) {
    return;
  }

  const [first] = child.children;

  if (first?.type === "WhiteSpaceNode") {
    child.children.shift();
    parent.children.splice(index, 0, first);
  }
});

const makeFinalWhiteSpaceSiblings: Modifier = (child, index, parent) => {
  if (!isParent(child)) {
    return index + 1;
  }

  const last = child.children.at(-1);

  if (last?.type === "WhiteSpaceNode") {
    child.children.pop();
    parent.children.splice(index + 1, 0, last);

    return index;
  }

  return index + 1;
};

const breakImplicitSentences: Modifier = (child, index, parent) => {
  if (child.type !== "SentenceNode" || !isParent(child)) {
    return index + 1;
  }

  const { children } = child;
  const length = children.length - 1;

  for (let position = 1; position < length; position += 1) {
    const node = children[position];

    if (node?.type === "WhiteSpaceNode" && newLineMulti.test(textOf(node))) {
      child.children = children.slice(0, position);
      parent.children.splice(index + 1, 0, node, {
        children: children.slice(position + 1),
        type: "SentenceNode",
      });

      return index + 1;
    }
  }

  return index + 1;
};

const removeEmptyNodes: Modifier = (child, index, parent) => {
  if (isParent(child) && child.children.length === 0) {
    parent.children.splice(index, 1);

    return index;
  }

  return index + 1;
};

const sentencePlugins = [
  modifyChildren(mergeInitialWordSymbol),
  modifyChildren(mergeFinalWordSymbol),
  modifyChildren(mergeInnerWordSymbol),
  modifyChildren(mergeInnerWordSlash),
  modifyChildren(mergeInitialisms),
  modifyChildren(mergeWords),
];

const paragraphPlugins = [
  modifyChildren(mergeNonWordSentences),
  modifyChildren(mergeAffixSymbol),
  modifyChildren(mergeInitialLowerCaseLetterSentences),
  modifyChildren(mergeInitialDigitSentences),
  modifyChildren(mergePrefixExceptions),
  modifyChildren(mergeAffixExceptions),
  mergeRemainingFullStops,
  makeInitialWhiteSpaceSiblings,
  modifyChildren(makeFinalWhiteSpaceSiblings),
  modifyChildren(breakImplicitSentences),
  modifyChildren(removeEmptyNodes),
];

const rootPlugins = [
  makeInitialWhiteSpaceSiblings,
  modifyChildren(makeFinalWhiteSpaceSiblings),
  modifyChildren(removeEmptyNodes),
];

const runPlugins = (
  plugins: readonly ((node: LatinParent) => void)[],
  node: LatinParent
) => {
  for (const plugin of plugins) {
    plugin(node);
  }

  return node;
};

const parseLatin = (value: string): LatinParent => {
  const sentence = runPlugins(sentencePlugins, {
    children: tokenize(value),
    type: "SentenceNode",
  });

  const paragraph = runPlugins(paragraphPlugins, {
    children: splitAt(
      sentence,
      "PunctuationNode",
      terminalMarker,
      "SentenceNode"
    ),
    type: "ParagraphNode",
  });

  return runPlugins(rootPlugins, {
    children: splitAt(paragraph, "WhiteSpaceNode", newLine, "ParagraphNode"),
    type: "RootNode",
  });
};

interface QuoteContext {
  readonly next: LatinNode | undefined;
  readonly nextNext: LatinNode | undefined;
  readonly nextValue: string;
  readonly previous: LatinNode | undefined;
  readonly value: string;
}

const closesBeforeMark = (context: QuoteContext) =>
  isMark(context.next) &&
  context.nextNext !== undefined &&
  context.nextNext.type !== "WordNode";

const opensNestedQuote = (context: QuoteContext) =>
  context.nextNext?.type === "WordNode" &&
  isMark(context.next) &&
  (context.nextValue === '"' || context.nextValue === "'");

const abbreviatesDecade = (context: QuoteContext) =>
  context.next !== undefined && decade.test(context.nextValue);

const opensAfterBreak = (context: QuoteContext) =>
  (context.previous?.type === "WhiteSpaceNode" || isMark(context.previous)) &&
  context.next?.type === "WordNode";

const closesAfterWord = (context: QuoteContext) =>
  context.previous !== undefined &&
  context.previous.type !== "WhiteSpaceNode" &&
  !isMark(context.previous);

const closesBeforeBreak = (context: QuoteContext) =>
  context.next === undefined ||
  context.next.type === "WhiteSpaceNode" ||
  (context.value === "'" && context.nextValue === "s");

const quoteDirection = (context: QuoteContext) => {
  if (closesBeforeMark(context)) {
    return "closing";
  }

  if (opensNestedQuote(context)) {
    return "nested";
  }

  if (abbreviatesDecade(context)) {
    return "closing";
  }

  if (opensAfterBreak(context)) {
    return "opening";
  }

  return closesAfterWord(context) || closesBeforeBreak(context)
    ? "closing"
    : "opening";
};

const educateQuote = (node: LatinLeaf, index: number, parent: LatinParent) => {
  const { value } = node;
  const opening = openingQuotes.get(value);
  const closing = closingQuotes.get(value);

  if (opening === undefined || closing === undefined) {
    return;
  }

  const siblings = parent.children;
  const next = siblings[index + 1];
  const nextValue = textOf(next);

  const direction = quoteDirection({
    next,
    nextNext: siblings[index + 2],
    nextValue,
    previous: siblings[index - 1],
    value,
  });

  node.value = direction === "closing" ? closing : opening;

  if (direction === "nested" && isMark(next)) {
    next.value = openingQuotes.get(nextValue) ?? nextValue;
  }
};

const educateEllipsis = (
  node: LatinLeaf,
  index: number,
  parent: LatinParent
) => {
  if (threeFullStops.test(node.value)) {
    node.value = "\u2026";

    return;
  }

  if (!fullStops.test(node.value)) {
    return;
  }

  const siblings = parent.children;
  let removed = 0;
  let position = index;
  let count = 1;

  for (;;) {
    position -= 1;

    if (position <= 0) {
      break;
    }

    const space = siblings[position];

    if (space?.type !== "WhiteSpaceNode") {
      break;
    }

    position -= 1;
    const stops = siblings[position];

    if (isMark(stops) && fullStops.test(stops.value)) {
      removed += 2;
      count += 1;

      continue;
    }

    break;
  }

  if (count < 3) {
    return;
  }

  siblings.splice(index - removed, removed);
  node.value = "\u2026";
};

const educateBackticks = (node: LatinLeaf) => {
  if (node.value === "``") {
    node.value = "\u201C";
  } else if (node.value === "''") {
    node.value = "\u201D";
  }
};

const educateDashes = (node: LatinLeaf) => {
  if (node.value === "--") {
    node.value = "\u2014";
  }
};

const educate = (node: LatinParent) => {
  let index = 0;

  while (index < node.children.length) {
    const child = node.children[index];

    if (isMark(child)) {
      educateQuote(child, index, node);
      educateEllipsis(child, index, node);
      educateBackticks(child);
      educateDashes(child);
    } else if (isParent(child)) {
      educate(child);
    }

    index += 1;
  }
};

export const smartypants = (value: string): string => {
  const tree = parseLatin(value);
  educate(tree);

  return textOf(tree);
};
