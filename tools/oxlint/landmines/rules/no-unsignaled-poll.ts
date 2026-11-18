import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";
import { Schema } from "effect";

import {
  hasImport,
  imported,
  isCallback,
  matchesImport,
  memberName,
  vitest,
} from "../syntax.ts";

const spyMatchers =
  /^(?:toHaveBeenCalled|toHaveBeenCalledOnce|toHaveBeenCalledTimes|toHaveBeenCalledWith|toHaveBeenCalledExactlyOnceWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toHaveReturned|toHaveReturnedTimes|toHaveReturnedWith|toHaveLastReturnedWith|toHaveNthReturnedWith|toHaveResolved|toHaveResolvedTimes|toHaveResolvedWith|toHaveLastResolvedWith|toHaveNthResolvedWith)$/u;
const mockFields = new Set([
  "calls",
  "contexts",
  "instances",
  "invocationCallOrder",
  "lastCall",
  "results",
  "settledResults",
]);
const defaultRecorders = [
  "requests",
  "recordedRequests",
  "requestedChunks",
  "requestLog",
  "recordedCalls",
];
const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        recorderNames: Schema.optionalKey(Schema.Array(Schema.String)),
      })
    ),
  ])
);

function path(node: ESTree.Node): string[] | undefined {
  if (node.type === "ChainExpression") {
    return path(node.expression);
  }
  if (node.type === "Identifier") {
    return [node.name];
  }
  if (node.type === "MemberExpression") {
    const object = path(node.object);
    return object && [...object, memberName(node) ?? "[]"];
  }
  return undefined;
}

function readsRecorder(
  node: ESTree.Node,
  recorders: ReadonlySet<string>,
  matcher?: string
) {
  const names = path(node);
  if (!names || names.includes("current")) {
    return false;
  }
  const last = names.at(-1) ?? "";
  return (
    names.some(
      (part, index) => part === "mock" && mockFields.has(names[index + 1] ?? "")
    ) ||
    ((last === "length" || last === "size") &&
      recorders.has(names.at(-2) ?? "")) ||
    (matcher === "toHaveLength" && recorders.has(last))
  );
}

function polledValue(callback: ESTree.Node | undefined) {
  if (!isCallback(callback)) {
    return undefined;
  }
  if (callback.body.type !== "BlockStatement") {
    return callback.body;
  }
  const [statement, ...rest] = callback.body.body;
  if (rest.length > 0) {
    return undefined;
  }
  if (statement?.type === "ReturnStatement") {
    return statement.argument;
  }
  return statement?.type === "ExpressionStatement"
    ? statement.expression
    : undefined;
}

function matcherCall(node: ESTree.MemberExpression) {
  return node.parent.type === "MemberExpression" && memberName(node) === "not"
    ? node.parent
    : node;
}

function assertsRecorder(
  source: SourceCode,
  node: ESTree.Node,
  recorders: ReadonlySet<string>
) {
  if (
    node.type !== "CallExpression" ||
    node.callee.type !== "MemberExpression"
  ) {
    return false;
  }
  const matcher = memberName(node.callee) ?? "";
  const subject =
    node.callee.object.type === "MemberExpression" &&
    memberName(node.callee.object) === "not"
      ? node.callee.object.object
      : node.callee.object;
  if (
    subject.type !== "CallExpression" ||
    !matchesImport(imported(source, subject.callee), vitest, "expect")
  ) {
    return false;
  }
  const [target] = subject.arguments;
  return (
    target !== undefined &&
    (assertsSpy(target, matcher) || readsRecorder(target, recorders, matcher))
  );
}

function assertsSpy(node: ESTree.Node, matcher: string) {
  const names = path(node);
  return (
    names !== undefined &&
    !names.includes("current") &&
    spyMatchers.test(matcher)
  );
}

export const noUnsignaledPoll = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          recorderNames: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    docs: {
      description:
        "Disallow deadline-bound polls of spies or request recorders.",
    },
    messages: {
      poll: "This test polls a spy or recorder against a deadline. The counter does not signal when its producer has finished. Fix: await the producer or complete a `Deferred` from the recording callback.",
    },
  },
  create(context) {
    const [options] = decodeOptions(context.options);
    const recorders = new Set(options?.recorderNames ?? defaultRecorders);
    const source = context.sourceCode;
    if (!hasImport(source, vitest)) {
      return {};
    }
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") {
          return;
        }
        const method = memberName(node.callee);
        if (method !== "poll" && method !== "waitFor") {
          return;
        }
        const poll = method === "poll";
        if (
          !matchesImport(
            imported(source, node.callee.object),
            vitest,
            poll ? "expect" : "vi"
          )
        ) {
          return;
        }
        const value = polledValue(node.arguments[0]);
        if (!value) {
          return;
        }
        const matcher =
          poll && node.parent.type === "MemberExpression"
            ? memberName(matcherCall(node.parent))
            : undefined;
        if (
          readsRecorder(value, recorders, matcher) ||
          (poll
            ? assertsSpy(value, matcher ?? "")
            : assertsRecorder(source, value, recorders))
        ) {
          context.report({ node, messageId: "poll" });
        }
      },
    };
  },
});
