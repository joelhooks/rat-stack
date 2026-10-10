import { expect, it } from "@effect/vitest";
import { localLearnCapabilities } from "@rat-stack/learn/local";

import { copyPrompts } from "../scripts/component-data.ts";
import { contentCapabilities } from "../src/capabilities/index.ts";

const steps = copyPrompts.learn.text.split("\n");

const toolNames = (text: string) =>
  [...text.matchAll(/\blearn[A-Z][A-Za-z]*\b/gu)].map(([name]) => name);

const servedBy = (capabilities: readonly { contract: { name: string } }[]) =>
  new Set(capabilities.map((capability) => capability.contract.name));

it("names only public MCP tools for the public deck step", () => {
  const publicStep = steps.find((step) => step.includes("/mcp"));
  const named = toolNames(publicStep ?? "");

  expect(named.length).toBeGreaterThan(0);
  expect(
    named.filter((name) => !servedBy(contentCapabilities).has(name))
  ).toEqual([]);
});

it("names only tools the local CLI serves", () => {
  const named = toolNames(copyPrompts.learn.text);
  const local = servedBy(localLearnCapabilities);

  expect(new Set(named)).toEqual(local);
});
