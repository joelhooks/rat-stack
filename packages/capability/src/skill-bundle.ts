import { Schema } from "effect";
import type { SkillOptions } from "effect/ai/McpServer";

export const skillBundlePath = "/_content/skills.json";

export const SkillBundle = Schema.Array(
  Schema.Struct({
    files: Schema.TupleWithRest(
      Schema.Tuple([
        Schema.Struct({
          path: Schema.Literal("SKILL.md"),
          text: Schema.String,
        }),
      ]),
      [Schema.Struct({ path: Schema.String, text: Schema.String })]
    ),
    name: Schema.String,
    version: Schema.String,
  })
);

export const mcpSkillOptions = (
  skill: (typeof SkillBundle.Type)[number]
): SkillOptions => ({
  files: {
    ...Object.fromEntries(
      skill.files.map(({ path, text }) => [
        path.split("/").map(encodeURIComponent).join("/"),
        text,
      ])
    ),
    "SKILL.md": skill.files[0].text,
  },
  uri: `skill://rat-stack/${skill.name}/SKILL.md`,
});
