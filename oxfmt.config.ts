import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  overrides: [
    {
      files: ["apps/web/test/fixtures/content-migration/*.md"],
      options: { proseWrap: "preserve" },
    },
  ],
});
