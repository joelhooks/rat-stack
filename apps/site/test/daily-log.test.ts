import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { dailyLogMarkdown, readDailyLog } from "../scripts/daily-log.ts";
import { markdownDiscoveryLinks } from "../src/content-links.ts";
import { readContent } from "./content-fixture.js";
import { lawSources } from "./generated-content.js";

it.effect(
  "groups a branched git history by day without duplicating merges or leaking identity",
  () =>
    Effect.gen(function* branchedHistory() {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const git = (args: readonly string[], date = "2026-09-20T12:00:00Z") =>
        spawner.string(
          ChildProcess.make(
            "git",
            [
              "-c",
              "user.name=Fixture",
              "-c",
              "user.email=author@example.invalid",
              ...args,
            ],
            {
              cwd: root,
              env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
            }
          )
        );

      yield* git(["init", "-b", "main"]);
      yield* fs.writeFileString(`${root}/README.md`, "# Read me");
      yield* git(["add", "README.md"]);
      yield* git(["commit", "-m", "Start reading"]);
      yield* git(["checkout", "-b", "page"]);
      yield* fs.makeDirectory(`${root}/.brain/resources`, { recursive: true });
      yield* fs.writeFileString(
        `${root}/.brain/resources/idea.svx`,
        "# An idea"
      );
      yield* git(["add", ".brain/resources/idea.svx"]);
      yield* git(["commit", "-m", "Add an idea"], "2026-09-21T14:00:00Z");
      const ideaHash = (yield* git(["rev-parse", "HEAD"])).trim();
      yield* git(["checkout", "main"]);
      yield* fs.writeFileString(`${root}/README.md`, "# Read me again");
      yield* fs.makeDirectory(`${root}/.brain/projects`, { recursive: true });
      yield* fs.writeFileString(
        `${root}/.brain/projects/private.svx`,
        "Private"
      );
      yield* git(["add", "README.md", ".brain/projects/private.svx"]);
      yield* git(
        ["commit", "-m", "Edit /Users/fixture/private author@example.invalid"],
        "2026-09-21T16:00:00Z"
      );
      yield* git(
        ["merge", "--no-ff", "page", "-m", "Merge the idea"],
        "2026-09-22T12:00:00Z"
      );

      const pages = [
        { routePath: "/README.md", sourcePath: "README.md", title: "Read me" },
        {
          routePath: "/resources/idea",
          sourcePath: ".brain/resources/idea.svx",
          title: "An idea",
        },
      ];

      const markdown = yield* readDailyLog(root, pages);

      expect(markdown.match(/## 2026-09-21/gu)).toHaveLength(1);
      expect(markdown.indexOf("## 2026-09-21")).toBeLessThan(
        markdown.indexOf("## 2026-09-20")
      );
      expect(markdown.indexOf("edited:")).toBeLessThan(
        markdown.indexOf("new page: [Add an idea]")
      );
      expect(markdown).toContain(
        "[Read me](/README.md) — new page: [Start reading]"
      );
      expect(markdown).toContain(
        `[An idea](/resources/idea) — new page: [Add an idea](https://github.com/joelhooks/rat-stack/commit/${ideaHash})`
      );
      expect(markdown).not.toContain("Merge the idea");
      expect(markdown).not.toContain("2026-09-22");
      expect(markdown).not.toContain("author@example.invalid");
      expect(markdown).not.toContain("/Users/");
      expect(markdown).not.toContain(".brain/projects");

      const shallow = `${root}/shallow`;
      yield* git(["clone", "--depth=1", `file://${root}`, shallow]);
      const fallback = yield* readDailyLog(shallow, pages);
      expect(fallback).toContain("shallow checkout");
      expect(fallback).not.toContain("## 2026");
      const missing = yield* readDailyLog(`${root}/missing`, pages);
      expect(missing).toContain("could not be read");
    }).pipe(Effect.provide(NodeServices.layer))
);

it("skips merge records defensively and escapes subjects as plain text", () => {
  const hash = "a".repeat(40);
  const parent = "b".repeat(40);

  const markdown = dailyLogMarkdown(
    `\u001E${hash}\t2026-09-21\t1\t${parent} ${hash}\tMerge\nM\tREADME.md\n\u001E${parent}\t2026-09-20\t0\t\tUse <script> {code} [links]\nA\tREADME.md`,
    []
  );

  expect(markdown).not.toContain("## 2026-09-21");
  expect(markdown).not.toContain("<script>");
  expect(markdown).not.toContain("{code}");
  expect(markdown).toContain(`${parent}/README.md`);
});

it("links removed content to its last revision", () => {
  const hash = "a".repeat(40);
  const parent = "b".repeat(40);

  const markdown = dailyLogMarkdown(
    `\u001E${hash}\t2026-09-21\t1\t${parent}\tRemove an old page\nD\t.brain/resources/old.svx`,
    []
  );

  expect(markdown).toContain(
    `[old.svx](https://github.com/joelhooks/rat-stack/blob/${parent}/.brain/resources/old.svx) — edited: [Remove an old page]`
  );
});

it("keeps one generated log on both public routes and advertises its markdown variant", () => {
  const log = readContent("/log");
  const markdown = readContent("/log.md");
  expect(log).toBeDefined();
  expect(markdown?.text).toBe(log?.text);
  expect(
    lawSources.find((page) => page.routePath === "/log")?.documentHtml
  ).toContain('href="/log"');
  expect(markdownDiscoveryLinks("/log")[0]?.href).toBe("/log.md");
});
