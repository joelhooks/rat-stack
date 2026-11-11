import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  applyCommandPolicy,
  HOOK_BYPASS_REASON,
  NONINTERACTIVE_VCS_ENV,
} from "../../../scripts/vcs-command-policy.js";

const blocked = { action: "block", reason: HOOK_BYPASS_REASON } as const;

const bypasses = [
  "git commit --no-verify -m wip",
  "git commit --no-verif -m wip",
  "git push --no-verify",
  "git merge --no-verify feature",
  "cd sub && git commit -m 'wip' --no-verify",
  "/usr/bin/git commit --no-verify",
  "git commit -n -m wip",
  "git commit -nm wip",
  "git commit -anm wip",
  "git commit -m wip -n",
  "git -C . commit -n",
  "git -c core.hooksPath=/dev/null commit -m wip",
  "git -c core.hookspath=/dev/null commit -m wip",
  "git config core.hooksPath .nohooks",
  "git config set core.hooksPath .nohooks",
  "LEFTHOOK=0 git commit -m wip",
  "LEFTHOOK=false git commit -m wip",
  "env LEFTHOOK=0 git commit -m wip",
  "export LEFTHOOK=0",
  "HUSKY=0 git commit -m wip",
  "LEFTHOOK_EXCLUDE=check git commit -m wip",
  "pnpm exec lefthook uninstall",
  "rm -rf .git/hooks",
  "echo exit 0 > .git/hooks/pre-commit",
  "cat noop >> .git/hooks/pre-commit",
  "chmod -x .git/hooks/pre-commit",
  'bash -c "git commit --no-verify"',
  "sh -c 'git commit -n -m wip'",
];

const ordinary = [
  "git status",
  "git commit -m 'add -n flag docs'",
  "git commit -m '--no-verify is banned'",
  "git commit -m wip",
  "git commit -am wip",
  "git commit -F msg.txt -- -n",
  "git commit --message -nope",
  "git commit --author -n -m wip",
  "git log -n 5",
  "git push -n origin main",
  "git add -n .",
  "git config --get core.hooksPath",
  "ls .git/hooks",
  "cat .git/hooks/pre-commit",
  "pnpm check",
  "grep -rn no-verify docs",
  "some-tool --no-verify",
  "LEFTHOOK=1 git commit -m wip",
];

const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const messages = Arbitrary.schema(Schema.String);

describe("vcs command policy", () => {
  it("leaves unrelated shell commands unchanged", () => {
    expect(applyCommandPolicy("pnpm test")).toEqual({
      action: "allow",
      command: "pnpm test",
    });
  });

  it("prevents Git from opening an editor", () => {
    expect(applyCommandPolicy("cd repo && git rebase -i HEAD~2")).toEqual({
      action: "allow",
      command: `${NONINTERACTIVE_VCS_ENV}cd repo && git rebase -i HEAD~2`,
    });
  });

  it("also prevents Jujutsu from opening an editor", () => {
    expect(applyCommandPolicy("jj describe")).toEqual({
      action: "allow",
      command: `${NONINTERACTIVE_VCS_ENV}jj describe`,
    });
  });

  it("blocks every way to skip or disable the hooks", () => {
    expect(
      bypasses.filter(
        (command) => applyCommandPolicy(command).action !== "block"
      )
    ).toEqual([]);
  });

  it("allows ordinary commands that only look like a bypass", () => {
    expect(
      ordinary.filter(
        (command) => applyCommandPolicy(command).action !== "allow"
      )
    ).toEqual([]);
  });

  it.prop(
    "never blocks a commit for the words in its message",
    [messages],
    ([message]) => {
      expect(
        applyCommandPolicy(`git commit -m ${quoted(message)}`).action
      ).toBe("allow");
    }
  );

  it.prop(
    "blocks a hook bypass whatever the commit message says",
    [messages],
    ([message]) => {
      expect(
        [
          `git commit -n -m ${quoted(message)}`,
          `git commit -m ${quoted(message)} --no-verify`,
          `LEFTHOOK=0 git commit -m ${quoted(message)}`,
          `bash -c ${quoted(`git commit -nm ${quoted(message)}`)}`,
        ].map(applyCommandPolicy)
      ).toEqual([blocked, blocked, blocked, blocked]);
    }
  );
});
