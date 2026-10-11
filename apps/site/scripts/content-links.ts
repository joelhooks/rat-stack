import { isPlainEffect } from "./content-lib.ts";
import type { ResponsiveTableNode } from "./content-lib.ts";

const stackEntities: readonly (readonly [pattern: string, href: string])[] = [
  ["Effect diagnostics", "https://github.com/Effect-TS/language-service"],
  ["Cloudflare Workers?", "https://developers.cloudflare.com/workers/"],
  ["TypeScript 7", "https://github.com/microsoft/typescript-go"],
  ["TypeScript", "https://www.typescriptlang.org"],
  ["Turborepo", "https://turborepo.com"],
  ["Effect", "https://effect.website"],
  ["XState", "https://stately.ai/docs/xstate"],
  ["Oxlint", "https://oxc.rs/docs/guide/usage/linter"],
  ["Oxfmt", "https://oxc.rs/docs/guide/usage/formatter"],
  ["Vitest", "https://vitest.dev"],
  ["lefthook", "https://lefthook.dev"],
  ["pnpm", "https://pnpm.io"],
  ["Alchemy", "https://alchemy.run"],
  ["OpenAPI", "https://www.openapis.org"],
  ["MCP", "https://modelcontextprotocol.io"],
];

const entityPattern = new RegExp(
  `(?<![\\w./-])(?<entity>${stackEntities.map(([pattern]) => pattern).join("|")})(?![\\w./-])`,
  "gu"
);

const entityHref = (name: string) =>
  stackEntities.find(([pattern]) =>
    new RegExp(`^(?:${pattern})$`, "u").test(name)
  )?.[1];

const skippedByEntityLinker = new Set([
  "a",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "th",
  "figure",
]);

export const linkStackEntities = () => {
  const visit = (node: ResponsiveTableNode, linked: Set<string>): void => {
    if (node.tagName !== undefined && skippedByEntityLinker.has(node.tagName)) {
      return;
    }

    const children = node.children ?? [];

    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];

      if (
        child === undefined ||
        (child.tagName !== undefined &&
          skippedByEntityLinker.has(child.tagName))
      ) {
        continue;
      }

      const { value } = child;

      if (child.type !== "text" || value === undefined) {
        visit(child, linked);
        continue;
      }

      const replacement: ResponsiveTableNode[] = [];
      let cursor = 0;

      for (const match of value.matchAll(entityPattern)) {
        const name = match.groups?.entity;
        const href = name === undefined ? undefined : entityHref(name);

        if (
          name === undefined ||
          href === undefined ||
          linked.has(href) ||
          isPlainEffect(name, value.slice(0, match.index))
        ) {
          continue;
        }

        linked.add(href);
        replacement.push(
          { type: "text", value: value.slice(cursor, match.index) },
          {
            children: [{ type: "text", value: name }],
            properties: { href },
            tagName: "a",
            type: "element",
          }
        );
        cursor = match.index + name.length;
      }

      if (replacement.length === 0) {
        continue;
      }

      replacement.push({ type: "text", value: value.slice(cursor) });
      children.splice(index, 1, ...replacement);
      index += replacement.length - 1;
    }
  };

  return (tree: ResponsiveTableNode) => {
    visit(tree, new Set<string>());
  };
};
