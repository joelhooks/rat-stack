import { Schema } from "effect";

export const skillBundlePath = "/_content/skills.json";

export const SkillBundle = Schema.Array(
  Schema.Struct({
    files: Schema.Array(
      Schema.Struct({ path: Schema.String, text: Schema.String })
    ),
    name: Schema.String,
    version: Schema.String,
  })
);
