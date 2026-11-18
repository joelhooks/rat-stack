import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import { Schema } from "effect";

import { budgetMessage } from "../finding.ts";
import {
  budgetLabel,
  expressionLabel,
  hasImport,
  hookNames,
  imported,
  inlineValue,
  isCallback,
  keyName,
  matchesImport,
  returnExpressions,
  runner,
  testModules,
  testOwner,
  vitest,
} from "../syntax.ts";

const configModule = ["vitest/config"];
const configTimeouts = new Set(["testTimeout", "hookTimeout"]);
const testTimeouts = new Set(["timeout"]);
const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        check: Schema.optionalKey(Schema.Literals(["retry", "timeout"])),
      })
    ),
  ])
);

const objectFields = (node: ESTree.Node | undefined | null) =>
  node?.type === "ObjectExpression"
    ? node.properties.filter((property) => property.type === "Property")
    : [];

const fieldValue = (node: ESTree.Node | undefined, name: string) =>
  objectFields(node).find((property) => keyName(property) === name)?.value;

export const noFlakeMasking = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { check: { enum: ["retry", "timeout"] } },
        additionalProperties: false,
      },
    ],
    docs: {
      description:
        "Disallow test retries and track explicit test timeout overrides.",
    },
    messages: {
      retry:
        "This test can rerun after a failure. Reruns can turn a flaky failure into a green run. Fix: use `retry: 0`, remove `flakyTest`, or await the missing completion signal.",
      timeout: budgetMessage(
        "This test or config sets an explicit timeout",
        "A larger deadline can hide a test that never receives its completion signal",
        "await the completion signal, move setup into a shared `Layer`, or document the budget in `tools/oxlint/landmines/baseline.json`"
      ),
    },
  },
  create(context) {
    const [options] = decodeOptions(context.options);
    const check = options?.check ?? "retry";
    const source = context.sourceCode;
    if (!hasImport(source, [...testModules, ...configModule])) {
      return {};
    }

    function reportTimeout(
      node: ESTree.Node,
      kind: string,
      owner: readonly string[],
      key: string,
      value: ESTree.Node
    ) {
      const signature = JSON.stringify([
        kind,
        owner,
        key,
        budgetLabel(source, value),
      ]);
      context.report({ node, messageId: "timeout", data: { signature } });
    }

    function inspect(
      node: ESTree.Node | undefined,
      kind: string,
      owner: readonly string[],
      keys: ReadonlySet<string>,
      supportsRetry = true
    ) {
      for (const property of objectFields(inlineValue(source, node))) {
        const key = keyName(property);
        if (
          check === "retry" &&
          supportsRetry &&
          key === "retry" &&
          !isZero(property.value)
        ) {
          context.report({ node: property, messageId: "retry" });
        } else if (check === "timeout" && key !== undefined && keys.has(key)) {
          reportTimeout(property, kind, owner, key, property.value);
        }
      }
    }

    function isZero(node: ESTree.Node) {
      const value = inlineValue(source, node);
      return value?.type === "Literal" && value.value === 0;
    }

    function configOptions(node: ESTree.Node | undefined, owner: string) {
      inspect(node, "config", [owner], configTimeouts);
      const projects = fieldValue(inlineValue(source, node), "projects");
      if (projects?.type !== "ArrayExpression") {
        return;
      }
      for (const [index, project] of projects.elements.entries()) {
        const test = fieldValue(project ?? undefined, "test");
        const name = fieldValue(test, "name");
        configOptions(
          test,
          `${owner}.projects[${name ? expressionLabel(source, name) : index}].test`
        );
      }
    }

    return {
      CallExpression(node) {
        const ref = imported(source, node.callee);
        if (
          matchesImport(ref, ["@effect/vitest"], "flakyTest") ||
          matchesImport(ref, ["@effect/vitest"], "it.flakyTest")
        ) {
          if (check === "retry") {
            context.report({ node, messageId: "retry" });
          }
          return;
        }
        if (matchesImport(ref, vitest, "vi.setConfig")) {
          configOptions(node.arguments[0], "vi.setConfig");
          return;
        }
        if (
          matchesImport(ref, configModule, "defineConfig") ||
          matchesImport(ref, configModule, "defineProject") ||
          matchesImport(ref, configModule, "mergeConfig")
        ) {
          for (const argument of node.arguments) {
            for (const config of returnExpressions(argument)) {
              configOptions(
                fieldValue(inlineValue(source, config), "test"),
                "test"
              );
            }
          }
          return;
        }
        const test = runner(source, node);
        if (
          !test ||
          hookNames.has(test.name) ||
          test.members.includes("layer")
        ) {
          return;
        }
        const [, second, third, fourth] = node.arguments;
        const propertyTest = test.members.includes("prop");
        const trailing = propertyTest ? fourth : third;
        const owner = check === "timeout" ? testOwner(source, node) : [];
        if (
          !propertyTest &&
          inlineValue(source, second)?.type === "ObjectExpression" &&
          !test.alchemy
        ) {
          inspect(second, "test", owner, testTimeouts);
        } else if (trailing) {
          inspect(trailing, "test", owner, testTimeouts, !test.alchemy);
          const actual = inlineValue(source, trailing);
          if (
            check === "timeout" &&
            actual?.type !== "ObjectExpression" &&
            actual?.type !== "SpreadElement" &&
            !isCallback(actual)
          ) {
            reportTimeout(trailing, "test", owner, "timeout", trailing);
          }
        }
      },
    };
  },
});
