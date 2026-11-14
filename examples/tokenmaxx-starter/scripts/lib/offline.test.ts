import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";

import { checkoutState, trustFolder } from "./offline.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-offline-test-")));
afterAll(() => rmSync(scratch, { recursive: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();

describe("checkoutState", () => {
  it("is missing, wrong-commit, no-dependencies, then ready", () => {
    const dir = join(scratch, "pinned");
    expect(checkoutState(dir, "a".repeat(40))).toEqual({ kind: "missing" });
    mkdirSync(dir);
    git(dir, "init", "-q");
    git(dir, "commit", "-q", "--allow-empty", "-m", "one");
    const head = git(dir, "rev-parse", "HEAD");
    expect(checkoutState(dir, "a".repeat(40))).toEqual({
      kind: "wrong-commit",
      commit: head,
    });
    expect(checkoutState(dir, head)).toEqual({ kind: "no-dependencies" });
    mkdirSync(join(dir, "node_modules"));
    expect(checkoutState(dir, head)).toEqual({ kind: "ready" });
  });
});

describe("trustFolder", () => {
  it("saves the same decision Pi's Trust choice does", () => {
    const agentDir = join(scratch, "agent");
    const folder = join(scratch, "starter");
    mkdirSync(folder);
    expect(new ProjectTrustStore(agentDir).get(folder)).toBeNull();
    const saved = trustFolder(folder, agentDir);
    expect(saved).toEqual({
      trustFile: join(agentDir, "trust.json"),
      trusted: true,
    });
    expect(JSON.parse(readFileSync(saved.trustFile, "utf8"))).toEqual({
      [folder]: true,
    });
    // A copy of the folder is a different path, so it is not trusted yet.
    expect(
      new ProjectTrustStore(agentDir).get(join(scratch, "copy"))
    ).toBeNull();
  });
});
