import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { applyUpdate, blobHash, type History, plan } from "./update.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-update-test-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const put = (dir: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
};
const read = (dir: string, path: string) =>
  readFileSync(join(dir, path), "utf8");
const hash = (text: string) => blobHash(Buffer.from(text));

let n = 0;
/** A guest's copy at `old` versions, and the new copy beside it. */
function copies(
  local: Record<string, string>,
  next: Record<string, string>
): { target: string; source: string } {
  n += 1;
  const target = join(scratch, `guest-${n}`);
  const source = join(target, ".workshop-state", "update");
  put(target, local);
  put(source, next);
  return { target, source };
}

/** What every shipped version of these files held. */
const history = (versions: Record<string, readonly string[]>): History => ({
  files: Object.fromEntries(
    Object.entries(versions).map(([path, texts]) => [path, texts.map(hash)])
  ),
});

const v3 = {
  "package.json": '{"name":"tokenmaxx-starter","version":"0.1.0"}\n',
  "README.md": "v3 readme\n",
  "AGENTS.md": "v3 agents\n",
  "shared/core/a.ts": "export const a = 3;\n",
  "shared/core/gone.ts": "export const gone = 3;\n",
};
const v4 = {
  "package.json": '{"name":"tokenmaxx-starter","version":"0.4.0"}\n',
  "README.md": "v4 readme\n",
  "AGENTS.md": "v4 agents\n",
  "shared/core/a.ts": "export const a = 4;\n",
  "turbo.json": "{}\n",
};
const known = history({
  "package.json": [v3["package.json"], v4["package.json"]],
  "README.md": [v3["README.md"], v4["README.md"]],
  "AGENTS.md": [v3["AGENTS.md"], v4["AGENTS.md"]],
  "shared/core/a.ts": [v3["shared/core/a.ts"], v4["shared/core/a.ts"]],
  "shared/core/gone.ts": [v3["shared/core/gone.ts"]],
  "turbo.json": [v4["turbo.json"]],
});
const now = new Date(Date.UTC(2026, 10, 17, 15, 0, 0));

describe("the update", () => {
  it("writes changed and new starter files, removes dropped ones, and leaves the guest's own alone", () => {
    const { target, source } = copies(
      {
        ...v3,
        ".workshop-state/sessions/ses_x.json": "{}\n",
        ".pi/extensions/mine.ts": "export const mine = 1;\n",
      },
      v4
    );
    const result = applyUpdate(target, source, known, { backup: false, now });
    expect(result.ok).toBe(true);
    for (const [path, text] of Object.entries(v4)) {
      expect(read(target, path)).toBe(text);
    }
    expect(existsSync(join(target, "shared/core/gone.ts"))).toBe(false);
    expect(read(target, ".workshop-state/sessions/ses_x.json")).toBe("{}\n");
    expect(read(target, ".pi/extensions/mine.ts")).toBe(
      "export const mine = 1;\n"
    );
  });

  it("keeps a doc the guest edited, and names it", () => {
    const { target, source } = copies(
      { ...v3, "AGENTS.md": "v3 agents\nMy memory lives in .memory/.\n" },
      v4
    );
    const result = applyUpdate(target, source, known, { backup: false, now });
    expect(result.ok && result.plan.kept).toEqual(["AGENTS.md"]);
    expect(read(target, "AGENTS.md")).toContain("My memory");
    expect(read(target, "README.md")).toBe(v4["README.md"]);
  });

  it("treats .pi/settings.json like any starter file: new version if unedited, kept if edited", () => {
    const settings = {
      v3: '{"packages":["v3"]}\n',
      v4: '{"packages":["v4"]}\n',
      mine: '{"packages":["v3","mine"]}\n',
    };
    const withSettings = history({
      ".pi/settings.json": [settings.v3, settings.v4],
    });
    const next = { ".pi/settings.json": settings.v4 };
    const plain = copies({ ".pi/settings.json": settings.v3 }, next);
    applyUpdate(plain.target, plain.source, withSettings, {
      backup: false,
      now,
    });
    expect(read(plain.target, ".pi/settings.json")).toBe(settings.v4);
    const edited = copies({ ".pi/settings.json": settings.mine }, next);
    const result = applyUpdate(edited.target, edited.source, withSettings, {
      backup: false,
      now,
    });
    expect(result.ok && result.plan.kept).toEqual([".pi/settings.json"]);
    expect(read(edited.target, ".pi/settings.json")).toBe(settings.mine);
  });

  it("stops before writing anything when the guest edited a file the new version can't run without", () => {
    const edited = '{"name":"tokenmaxx-starter","version":"0.1.0","x":1}\n';
    const { target, source } = copies({ ...v3, "package.json": edited }, v4);
    const result = applyUpdate(target, source, known, { backup: false, now });
    expect(result).toEqual({ ok: false, blocked: ["package.json"] });
    for (const [path, text] of Object.entries({
      ...v3,
      "package.json": edited,
    })) {
      expect(read(target, path)).toBe(text);
    }
    expect(existsSync(join(target, "turbo.json"))).toBe(false);
  });

  it("with backup, moves every file it doesn't recognise aside, then updates", () => {
    const edited = '{"name":"tokenmaxx-starter","version":"0.1.0","x":1}\n';
    const { target, source } = copies(
      {
        ...v3,
        "package.json": edited,
        "AGENTS.md": "mine\n",
        "shared/core/gone.ts": "export const gone = 99;\n",
      },
      v4
    );
    const result = applyUpdate(target, source, known, { backup: true, now });
    expect(result.ok).toBe(true);
    const backupDir = result.ok ? (result.backupDir ?? "") : "";
    expect(backupDir).toBe(
      ".workshop-state/update-backup/2026-11-17T15-00-00-000Z"
    );
    expect(read(join(target, backupDir), "package.json")).toBe(edited);
    expect(read(join(target, backupDir), "AGENTS.md")).toBe("mine\n");
    expect(read(join(target, backupDir), "shared/core/gone.ts")).toBe(
      "export const gone = 99;\n"
    );
    for (const [path, text] of Object.entries(v4)) {
      expect(read(target, path)).toBe(text);
    }
    expect(existsSync(join(target, "shared/core/gone.ts"))).toBe(false);
  });

  it("does nothing the second time, or on a copy that's already new", () => {
    const { target, source } = copies(v3, v4);
    applyUpdate(target, source, known, { backup: false, now });
    expect(plan(target, source, known)).toEqual({
      write: [],
      remove: [],
      kept: [],
      blocked: [],
      leftover: [],
    });
  });
});
