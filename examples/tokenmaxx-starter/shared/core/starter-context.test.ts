import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { addContextFile, fromFolder } from "./starter-context.ts";

type File = { path: string; content: string };
type Handler = (event: {
  systemPromptOptions: { cwd: string; contextFiles: File[] };
}) => void;

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

/** The extension's one handler, as Pi would call it before a run. */
function hooked(path: string): Handler {
  let handler: Handler | undefined;
  addContextFile(
    {
      on: ((event: string, h: Handler) => {
        expect(event).toBe("before_agent_start");
        handler = h;
      }) as never,
    },
    path
  );
  if (handler === undefined) {
    throw new Error("no before_agent_start handler");
  }
  return handler;
}

describe("the starter's AGENTS.md at the guest's root", () => {
  it("adds the file to Pi's context files once", async () => {
    dir = await mkdtemp(join(tmpdir(), "tmx-ctx-"));
    await mkdir(join(dir, "workshop"));
    const path = join(dir, "workshop", "AGENTS.md");
    await writeFile(path, "# Agent instructions\n");
    const run = hooked(path);
    const contextFiles: File[] = [{ path: "/guest/AGENTS.md", content: "g" }];
    run({ systemPromptOptions: { cwd: dir, contextFiles } });
    run({ systemPromptOptions: { cwd: dir, contextFiles } });
    // Added under its real path: on macOS the temp folder is behind /var,
    // a symlink to /private/var.
    expect(contextFiles).toEqual([
      { path: "/guest/AGENTS.md", content: "g" },
      {
        path: realpathSync(path),
        content: `${fromFolder(dir, path)}\n\n# Agent instructions\n`,
      },
    ]);
    expect(fromFolder(dir, path)).toContain("from its folder `workshop/`");
  });

  it("carries on without it when the file is missing", async () => {
    dir = await mkdtemp(join(tmpdir(), "tmx-ctx-"));
    const contextFiles: File[] = [];
    hooked(join(dir, "AGENTS.md"))({
      systemPromptOptions: { cwd: dir, contextFiles },
    });
    expect(contextFiles).toEqual([]);
  });
});
