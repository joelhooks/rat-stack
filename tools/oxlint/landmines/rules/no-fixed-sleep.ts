import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";
import { Schema } from "effect";

import { budgetMessage } from "../finding.ts";
import {
  budgetLabel,
  effectMethod,
  hasImport,
  imported,
  isCallback,
  matchesImport,
  memberName,
  runner,
  testModules,
  testOwner,
  vitest,
} from "../syntax.ts";

const defaultRunNow = ["act", "waitFor", "then", "catch", "finally", "step"];
const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({ runNow: Schema.optionalKey(Schema.Array(Schema.String)) })
    ),
  ])
);
const timerModules = ["node:timers/promises", "timers/promises"];

function isMember(node: ESTree.Node, object: string, property: string) {
  return (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === object &&
    memberName(node) === property
  );
}

function isSetTimeout(node: ESTree.Node) {
  return (
    (node.type === "Identifier" && node.name === "setTimeout") ||
    isMember(node, "globalThis", "setTimeout") ||
    isMember(node, "window", "setTimeout")
  );
}

function calleeName(node: ESTree.Node) {
  if (node.type === "Identifier") {
    return node.name;
  }
  return node.type === "MemberExpression" ? memberName(node) : undefined;
}

function owner(
  source: SourceCode,
  node: ESTree.Node,
  runNow: ReadonlySet<string>,
  effects: boolean
): ESTree.CallExpression | undefined {
  let current = node.parent;
  while (
    current &&
    !isCallback(current) &&
    current.type !== "FunctionDeclaration"
  ) {
    current = current.parent;
  }
  const call = current?.parent;
  if (call?.type !== "CallExpression") {
    return undefined;
  }
  if (runner(source, call)) {
    return call;
  }
  if (
    runNow.has(calleeName(call.callee) ?? "") ||
    (effects && effectMethod(source, call.callee, "gen"))
  ) {
    return owner(source, call, runNow, effects);
  }
  return undefined;
}

function scheduled(body: ESTree.Node) {
  if (body.type !== "BlockStatement") {
    return body;
  }
  const [statement, ...rest] = body.body;
  return statement?.type === "ExpressionStatement" && rest.length === 0
    ? statement.expression
    : undefined;
}

function resolvesAfterTimeout(node: ESTree.NewExpression) {
  const [executor] = node.arguments;
  if (!isCallback(executor)) {
    return false;
  }
  const [resolve] = executor.params;
  const call = scheduled(executor.body);
  if (
    resolve?.type !== "Identifier" ||
    call?.type !== "CallExpression" ||
    !isSetTimeout(call.callee)
  ) {
    return false;
  }
  const [handler] = call.arguments;
  if (handler?.type === "Identifier") {
    return handler.name === resolve.name;
  }
  const settle = isCallback(handler) ? scheduled(handler.body) : undefined;
  return (
    settle?.type === "CallExpression" &&
    settle.callee.type === "Identifier" &&
    settle.callee.name === resolve.name
  );
}

function fakeClockCall(source: SourceCode, node: ESTree.Node) {
  if (
    node.type !== "CallExpression" ||
    node.callee.type !== "MemberExpression"
  ) {
    return undefined;
  }
  const method = memberName(node.callee);
  if (
    (method !== "useFakeTimers" && method !== "useRealTimers") ||
    !matchesImport(imported(source, node.callee.object), vitest, "vi")
  ) {
    return undefined;
  }
  return method;
}

function usesLocalFakeClock(
  node: ESTree.Node,
  changes: readonly ESTree.CallExpression[],
  source: SourceCode
) {
  let statement = node;
  while (
    statement.parent &&
    statement.parent.type !== "BlockStatement" &&
    !isCallback(statement.parent)
  ) {
    statement = statement.parent;
  }
  const block = statement.parent;
  if (block?.type !== "BlockStatement" || !isCallback(block.parent)) {
    return false;
  }
  const last = changes.findLast(
    (change) =>
      change.range[0] >= block.range[0] && change.range[1] < node.range[0]
  );
  return (
    last?.parent.type === "ExpressionStatement" &&
    last.parent.parent === block &&
    last.range[1] < statement.range[0] &&
    last.arguments.length === 0 &&
    fakeClockCall(source, last) === "useFakeTimers"
  );
}

export const noFixedSleep = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { runNow: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    docs: {
      description: "Disallow fixed real-time sleeps in test and hook bodies.",
    },
    messages: {
      sleep: budgetMessage(
        "This test waits for a fixed real-time sleep",
        "The delay can guess when work will finish and race machine load",
        "await the operation or its completion `Deferred`; use `TestClock` when testing time"
      ),
    },
  },
  create(context) {
    const [options] = decodeOptions(context.options);
    const runNow = new Set(options?.runNow ?? defaultRunNow);
    const source = context.sourceCode;
    if (!hasImport(source, testModules)) {
      return {};
    }
    const clockChanges: ESTree.CallExpression[] = [];
    const hasEffect = hasImport(source, ["effect", "effect/Effect"]);

    function reportSleep(
      node: ESTree.Node,
      test: ESTree.CallExpression,
      name: string,
      value: ESTree.Node
    ) {
      const signature = JSON.stringify([
        "sleep",
        testOwner(source, test),
        name,
        budgetLabel(source, value),
      ]);
      context.report({ node, messageId: "sleep", data: { signature } });
    }

    return {
      CallExpression(node) {
        if (fakeClockCall(source, node)) {
          clockChanges.push(node);
        }
        if (hasEffect && effectMethod(source, node.callee, "sleep")) {
          const test = owner(source, node, runNow, true);
          if (test && runner(source, test)?.live) {
            reportSleep(node, test, "Effect.sleep", node.arguments[0] ?? node);
          }
        }
      },
      AwaitExpression(node) {
        const { argument } = node;
        const promiseTimer =
          argument.type === "NewExpression" &&
          argument.callee.type === "Identifier" &&
          argument.callee.name === "Promise" &&
          resolvesAfterTimeout(argument);
        const nativeSleep =
          argument.type === "CallExpression" &&
          (isMember(argument.callee, "scheduler", "wait") ||
            isMember(argument.callee, "Bun", "sleep") ||
            matchesImport(
              imported(source, argument.callee),
              timerModules,
              "setTimeout"
            ));
        if (
          !(promiseTimer || nativeSleep) ||
          (promiseTimer && usesLocalFakeClock(node, clockChanges, source))
        ) {
          return;
        }
        const test = owner(source, node, runNow, false);
        if (test) {
          reportSleep(node, test, "await", argument);
        }
      },
    };
  },
});
