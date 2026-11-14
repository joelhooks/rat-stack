import { describe, expect, it } from "vitest";

import {
  envPrintReason,
  guardEnv,
  isSecretFile,
  parseCommand,
} from "./env-guard.ts";

const env = {
  TMX_SESSION: "ses_test_000000000000",
  TMX_GUEST_PI_PID: "4242",
  ANTHROPIC_API_KEY: "not-a-real-key",
  HOME: "/guest-home",
  PATH: "/usr/bin",
};

const refused = [
  // Plain dumps
  "env",
  "printenv",
  "/usr/bin/env",
  "env -0",
  "env -u FOO",
  "set",
  "export",
  "export -p",
  "declare",
  "declare -x",
  "declare -p",
  "declare -px",
  "typeset",
  "typeset -x",
  // One value
  "printenv TMX_SESSION",
  "printenv ANTHROPIC_API_KEY HOME",
  "declare -p TMX_SESSION",
  "echo $TMX_SESSION",
  'echo "session: ${TMX_SESSION}"',
  "echo ${ANTHROPIC_API_KEY:0:6}",
  "printf '%s\\n' \"$ANTHROPIC_API_KEY\"",
  // Filtered, but values still come out
  "env | grep -E 'TMX|PI_'",
  "env | grep -i tmx",
  "env|grep TMX",
  "printenv|less",
  "env | sort",
  "printenv | grep TMX",
  "env | cut -d= -f2",
  "env | cut -d= -f1,2",
  "printenv TMX_SESSION | cut -d= -f1",
  "set | grep TMX",
  "export -p | grep TMX",
  // /proc
  "cat /proc/self/environ",
  "cat /proc/$$/environ | tr '\\0' '\\n'",
  "xargs -0 -n1 < /proc/1/environ",
  "strings /proc/12345/environ",
  "tr '\\0' '\\n' </proc/self/environ",
  // In a list, a subshell, a substitution
  "cd /tmp && env",
  "ls; env | grep TMX",
  "true || printenv",
  "(set -o posix; set)",
  "{ set; }",
  'echo "$(printenv TMX_SESSION)"',
  "echo `env`",
  "x=$(env); echo done",
  "if true; then env; fi",
  "env 2>&1 | head",
  "env > /tmp/env.txt",
  // Wrappers
  "sh -c env",
  "bash -c 'env | grep TMX'",
  "bash -lc 'printenv TMX_SESSION'",
  'zsh -c "echo \\$TMX_SESSION"',
  "eval env",
  "sudo env",
  "env FOO=1 env",
  "env -i env",
  "env -S 'printenv HOME'",
  "command env",
  "nohup env",
  "bash <<'EOF'\nenv | grep TMX\nEOF",
  // Other languages
  "node -e 'console.log(process.env)'",
  'node -p "process.env.TMX_SESSION"',
  "node --eval 'console.log(JSON.stringify(process.env))'",
  "python3 -c 'import os; print(os.environ)'",
  "python -c 'import os; print(os.getenv(\"TMX_SESSION\"))'",
  "python3 - <<'EOF'\nimport os\nfor k, v in os.environ.items():\n    print(k, v)\nEOF",
  "perl -e 'print \"$_=$ENV{$_}\\n\" for keys %ENV'",
  "ruby -e 'p ENV[\"TMX_SESSION\"]'",
  "bun -e 'console.log(Bun.env)'",
  "deno eval 'console.log(Deno.env.toObject())'",
  // Secrets files
  "cat .env",
  "cat ./.env.local",
  "cat apps/web/.env.production",
  "cat .env*",
  "less .env",
  "head -5 .env",
  "tail .dev.vars",
  "cat .envrc",
  "grep KEY .env",
  "grep -n ANTHROPIC .env.local",
  "rg API .env",
  "sed -n '1,5p' .env",
  "awk 1 .env",
  "sort .env",
  "cut -d= -f2 .env",
  "diff .env .env.example",
  "cat .env | grep KEY",
  "cat < .env",
  'while read -r line; do echo "$line"; done < .env',
  "source .env && echo $ANTHROPIC_API_KEY",
  'source .env; echo "$SOME_KEY_ONLY_IN_THE_FILE"',
  ". ./.env && printf '%s' \"$X\"",
  "set -a; source .env; set +a; env | grep KEY",
  "bash -c 'cat .env'",
  "node -e \"console.log(require('fs').readFileSync('.env', 'utf8'))\"",
  "python3 -c 'print(open(\".env\").read())'",
  "echo $(cat .env)",
];

const passed = [
  // Names only
  "env | cut -d= -f1",
  "env | cut -d '=' -f 1",
  "env|cut -d= -f1",
  "env | cut -f1 -d=",
  "env | cut -d= -f1 | sort",
  "env | grep TMX | cut -d= -f1",
  "env | sort | cut -d= -f1",
  "printenv | cut -d= -f1",
  "env | awk -F= '{print $1}'",
  "env | sed 's/=.*//'",
  "env | wc -l",
  "set | cut -d= -f1",
  "node -e 'console.log(Object.keys(process.env))'",
  // Running a command with an added variable
  "env VAR=x node scripts/ex.ts",
  "env FOO=1 BAR=2 pnpm ex 02.1 status",
  "env -u FOO pnpm test",
  "env -C /tmp ls",
  "/usr/bin/env node script.js",
  "TMX_STATE_DIR=/tmp/x pnpm ex 02.1 status",
  // Ordinary work
  "pnpm ex 02.1 status",
  "pnpm ex 02.1 status --session $TMX_SESSION",
  'curl -H "x-api-key: $ANTHROPIC_API_KEY" https://example.com',
  "echo $HOME $PATH",
  "echo hello",
  "echo 'env | grep TMX'",
  "echo '$TMX_SESSION'",
  "for f in *.ts; do echo $f; done",
  "count=3; echo $count",
  "echo $NOT_SET_ANYWHERE",
  "echo ${#TMX_SESSION}",
  "set -euo pipefail",
  "set -- a b",
  "export FOO=bar",
  "export FOO",
  "declare -a list",
  "declare -x FOO=bar",
  "declare -f my_function",
  "typeset -i n=3",
  "grep -rn 'process.env' src",
  "rg env shared/",
  // Secrets files: names only, templates, and use without printing
  "cat .env.example",
  "cat .env.sample apps/web/.env.local.example",
  "cut -d= -f1 .env",
  "cut -d '=' -f 1 .env.local",
  "cat .env | cut -d= -f1",
  "awk -F= '{print $1}' .env",
  "sed 's/=.*//' .env",
  "cut -d= -f1 < .env",
  "wc -l .env",
  "grep -c KEY .env",
  "grep -l KEY .env .env.local",
  "grep -q ANTHROPIC_API_KEY .env && echo present",
  "rg --files-with-matches KEY .env",
  "sed -i 's/^PORT=.*/PORT=4000/' .env",
  "ls -la .env",
  "test -f .env && echo yes",
  "cp .env.example .env",
  "echo 'PORT=3000' >> .env",
  "git check-ignore .env",
  "source .env && pnpm dev",
  "node --env-file=.env app.js",
  "docker run --env-file .env image",
  "cat environment.ts",
  "cat .environment",
  "ls /proc/self",
  "man env",
  "which env printenv",
  "command -v env",
  "git commit -m 'env guard: refuse env dumps'",
  "node scripts/ex.ts 02.1 status",
  "python3 -c 'print(1 + 1)'",
  "bash scripts/run.sh",
  "sh -c 'pnpm test'",
  "cat <<'EOF' > notes.md\nRun env | cut -d= -f1 to list names.\nEOF",
  "# env\nls",
];

describe("the env guard", () => {
  it.each(refused)("refuses %s", (command) => {
    expect(envPrintReason(command, env)).not.toBeNull();
  });

  it.each(passed)("passes %s", (command) => {
    expect(envPrintReason(command, env)).toBeNull();
  });

  it("says why, and where to look instead", () => {
    const reason = envPrintReason("env | grep TMX", env) ?? "";
    expect(reason).toContain("env with no command");
    expect(reason).toContain("pnpm ex <id> status");
    expect(reason).toContain("env | cut -d= -f1");
    expect(reason).not.toContain(env.ANTHROPIC_API_KEY);
    expect(
      envPrintReason("printenv", { ...env, TMX_EXERCISE: "02.1" })
    ).toContain("pnpm ex 02.1 status");
  });

  it("points a secrets file at a names-only read of it", () => {
    const reason = envPrintReason("cat apps/web/.env.local", env) ?? "";
    expect(reason).toContain("values in apps/web/.env.local");
    expect(reason).toContain("cut -d= -f1 apps/web/.env.local");
    expect(reason).toContain("pnpm ex <id> status");
  });

  it("knows a secrets file from a template", () => {
    for (const path of [".env", "a/.env.local", ".dev.vars", ".envrc"]) {
      expect(isSecretFile(path)).toBe(true);
    }
    for (const path of [".env.example", ".env.sample", "env.ts", ".envy"]) {
      expect(isSecretFile(path)).toBe(false);
    }
  });

  it("only refuses echo of a variable Pi actually has", () => {
    expect(envPrintReason("echo $TMX_SESSION", {})).toBeNull();
    expect(envPrintReason("echo $MY_LOCAL", { MY_LOCAL: "x" })).not.toBeNull();
  });
});

describe("the shell reader", () => {
  it("splits lists and pipelines, keeps quoting, drops redirect targets", () => {
    const pipelines = parseCommand(
      "a 'b c' \"$X\" 2>&1 >out | d; e && f <<'EOF'\nbody $Y\nEOF\ng"
    );
    expect(
      pipelines.map((p) => p.map((s) => s.words.map((w) => w.text)))
    ).toEqual([[["a", "b c", "$X"], ["d"]], [["e"]], [["f"]], [["g"]]]);
    expect(pipelines[0]?.[0]?.words[2]?.vars).toEqual(["X"]);
    expect(pipelines[2]?.[0]?.stdin).toEqual(["body $Y"]);
    expect(parseCommand("done < .env > out")[0]?.[0]?.inputs).toEqual([".env"]);
  });
});

type Handler = (event: unknown) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler>();
  return {
    on: ((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return () => undefined;
    }) as never,
    fire: (event: string, payload: unknown) => handlers.get(event)?.(payload),
  };
}

describe("guardEnv", () => {
  it("blocks a bash call that prints values and lets others run", () => {
    const pi = fakePi();
    guardEnv(pi, env);
    const call = (toolName: string, input: unknown) =>
      pi.fire("tool_call", { toolName, toolCallId: "t1", input });
    expect(call("bash", { command: "env | grep TMX" })).toMatchObject({
      block: true,
      reason: expect.stringContaining("pnpm ex <id> status"),
    });
    expect(call("bash", { command: "env | cut -d= -f1" })).toBeUndefined();
    expect(call("read", { path: "/proc/self/environ" })).toMatchObject({
      block: true,
    });
    expect(call("read", { path: "README.md" })).toBeUndefined();
    expect(call("read", { path: "/repo/.env.local" })).toMatchObject({
      block: true,
      reason: expect.stringContaining("cut -d= -f1 /repo/.env.local"),
    });
    expect(call("read", { path: ".dev.vars" })).toMatchObject({ block: true });
    expect(call("read", { path: ".env.example" })).toBeUndefined();
    expect(call("grep", { pattern: "KEY", path: ".env" })).toMatchObject({
      block: true,
    });
    expect(call("grep", { pattern: "KEY", path: "src" })).toBeUndefined();
    expect(call("write", { path: "x", content: "env" })).toBeUndefined();
    expect(call("bash", {})).toBeUndefined();
  });
});
