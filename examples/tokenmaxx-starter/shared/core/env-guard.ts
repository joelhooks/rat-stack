import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Refuses bash tool calls that would print environment values, or the values
// in a `.env` file. Guests bring real provider keys and share their screens,
// and an agent looking for TMX_SESSION tends to run `env | grep TMX`, which
// puts every value in the tool result, on the projector and in the session
// file. Loaded by ./turns-observer.ts into every `pnpm pi`.
//
// A guard against a careless agent, not a sandbox: it reads the command the
// way a shell would, roughly, and refuses the usual ways to print values. A
// script file that prints them, or a deliberately disguised command, gets
// through.
//
// Kept free of Effect: Pi loads it straight from source.

type Env = Readonly<Record<string, string | undefined>>;

type Hooks = Pick<ExtensionAPI, "on">;

type Word = {
  /** The word with quotes removed; `$NAME` stays as written. */
  readonly text: string;
  /** Variables the shell would expand in it. */
  readonly vars: readonly string[];
  /** Bodies of `$(...)` and backticks in it. */
  readonly subs: readonly string[];
};

type Stage = {
  readonly words: readonly Word[];
  /** Heredoc bodies fed to this command. */
  readonly stdin: readonly string[];
  /** Files fed to this command with `<`. */
  readonly inputs: readonly string[];
};

/** Stages joined by `|`. */
type Pipeline = readonly Stage[];

/** Variables that hold no secret and that agents print for good reasons. */
const harmless = new Set([
  "HOME",
  "PWD",
  "OLDPWD",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "TMPDIR",
  "HOSTNAME",
  "SHLVL",
  "COLUMNS",
  "LINES",
]);

const shells = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"]);

const interpreter =
  /^(node|nodejs|bun|deno|tsx|ts-node|python[0-9.]*|perl|ruby|php)$/;

/** Code that reads the environment, in the languages above. */
const envInCode =
  /process\.env|os\.environ|getenv|\bENV\[|%ENV|\$ENV\{|Deno\.env|Bun\.env|import\.meta\.env/;

/** Code that only lists names: allowed. */
const namesInCode =
  /Object\.keys\(\s*process\.env\s*\)|os\.environ\.keys\(\s*\)|list\(\s*os\.environ\s*\)/g;

/** Words that come before the command they run. */
const prefixes = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do",
  "time",
  "command",
  "builtin",
  "exec",
  "nohup",
  "sudo",
  "doas",
  "xargs",
  "stdbuf",
  "nice",
  "watch",
]);

const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;

const name = /^[A-Za-z_][A-Za-z0-9_]*/;

// ---------------------------------------------------------------- reading

/** Reads a command into pipelines, roughly as bash would. */
export function parseCommand(source: string): Pipeline[] {
  const pipelines: Pipeline[] = [];
  let stages: Stage[] = [];
  let words: Word[] = [];
  let stdin: string[] = [];
  let inputs: string[] = [];
  let pendingHeredocs: { delimiter: string; stage: string[] }[] = [];
  let text = "";
  let vars: string[] = [];
  let subs: string[] = [];
  let inWord = false;
  let redirect: "output" | "input" | null = null;
  let i = 0;

  const endWord = () => {
    if (inWord) {
      if (redirect === "input") {
        inputs.push(text);
      }
      if (redirect !== null) {
        redirect = null;
      } else {
        words.push({ text, vars, subs });
      }
    }
    text = "";
    vars = [];
    subs = [];
    inWord = false;
  };
  const endStage = () => {
    endWord();
    if (words.length > 0 || stdin.length > 0 || inputs.length > 0) {
      stages.push({ words, stdin, inputs });
    }
    words = [];
    stdin = [];
    inputs = [];
  };
  const endPipeline = () => {
    endStage();
    if (stages.length > 0) {
      pipelines.push(stages);
    }
    stages = [];
  };
  /** Index of the `close` that balances the opener just before `from`. */
  const balanced = (from: number, open: string, close: string) => {
    let depth = 1;
    let j = from;
    for (; j < source.length; j += 1) {
      const c = source[j];
      if (c === "\\") {
        j += 1;
      } else if (c === "'") {
        const end = source.indexOf("'", j + 1);
        j = end === -1 ? source.length : end;
      } else if (c === open) {
        depth += 1;
      } else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          return j;
        }
      }
    }
    return source.length;
  };
  /** Reads a `$...` expansion starting at `i` (the `$`). */
  const dollar = () => {
    const rest = source.slice(i + 1);
    if (rest.startsWith("((")) {
      const end = balanced(i + 3, "(", ")");
      text += source.slice(i, end + 2);
      i = end + 2;
      return;
    }
    if (rest.startsWith("(")) {
      const end = balanced(i + 2, "(", ")");
      subs.push(source.slice(i + 2, end));
      text += source.slice(i, end + 1);
      i = end + 1;
      return;
    }
    if (rest.startsWith("{")) {
      const end = balanced(i + 2, "{", "}");
      const inner = source.slice(i + 2, end);
      const found = name.exec(inner);
      if (found !== null) {
        vars.push(found[0]);
      }
      text += source.slice(i, end + 1);
      i = end + 1;
      return;
    }
    const found = name.exec(rest);
    if (found !== null) {
      vars.push(found[0]);
      text += `$${found[0]}`;
      i += 1 + found[0].length;
      return;
    }
    text += "$";
    i += 1;
  };
  const backtick = () => {
    const end = source.indexOf("`", i + 1);
    const stop = end === -1 ? source.length : end;
    subs.push(source.slice(i + 1, stop));
    text += source.slice(i, stop + 1);
    i = stop + 1;
  };
  /** At a newline: collects the bodies of heredocs opened on this line. */
  const heredocBodies = () => {
    for (const doc of pendingHeredocs) {
      const lines: string[] = [];
      for (;;) {
        const next = source.indexOf("\n", i);
        const line = source.slice(i, next === -1 ? source.length : next);
        i = next === -1 ? source.length : next + 1;
        if (line.replace(/^\t+/, "") === doc.delimiter || next === -1) {
          if (line.replace(/^\t+/, "") !== doc.delimiter) {
            lines.push(line);
          }
          break;
        }
        lines.push(line);
      }
      doc.stage.push(lines.join("\n"));
    }
    pendingHeredocs = [];
  };

  while (i < source.length) {
    const c = source[i] ?? "";
    if (c === "\\") {
      if (source[i + 1] !== "\n") {
        text += source[i + 1] ?? "";
        inWord = true;
      }
      i += 2;
    } else if (c === "'") {
      const end = source.indexOf("'", i + 1);
      const stop = end === -1 ? source.length : end;
      text += source.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
    } else if (c === '"') {
      inWord = true;
      i += 1;
      while (i < source.length && source[i] !== '"') {
        const d = source[i] ?? "";
        if (d === "\\") {
          text += source[i + 1] ?? "";
          i += 2;
        } else if (d === "$") {
          dollar();
        } else if (d === "`") {
          backtick();
        } else {
          text += d;
          i += 1;
        }
      }
      i += 1;
    } else if (c === "$" && source[i + 1] === "'") {
      const end = source.indexOf("'", i + 2);
      const stop = end === -1 ? source.length : end;
      text += source.slice(i + 2, stop);
      inWord = true;
      i = stop + 1;
    } else if (c === "$") {
      inWord = true;
      dollar();
    } else if (c === "`") {
      inWord = true;
      backtick();
    } else if (c === "#" && !inWord) {
      const next = source.indexOf("\n", i);
      i = next === -1 ? source.length : next;
    } else if (c === " " || c === "\t") {
      endWord();
      i += 1;
    } else if (c === "\n") {
      endPipeline();
      i += 1;
      heredocBodies();
    } else if (c === ";" || c === "(" || c === ")") {
      endPipeline();
      i += c === ";" && source[i + 1] === ";" ? 2 : 1;
    } else if (c === "&" || c === "|") {
      const doubled = source[i + 1] === c;
      if (c === "|" && !doubled) {
        endStage();
        i += source[i + 1] === "&" ? 2 : 1;
      } else {
        endPipeline();
        i += doubled ? 2 : 1;
      }
    } else if (c === "<" || c === ">") {
      // A redirection: `2>&1`, `>> file`, `< file`, `<<< "$X"`, `<<EOF`. Its
      // target is not an argument of the command; a `< file` is an input.
      if (/^\d+$/.test(text) && vars.length === 0) {
        text = "";
        inWord = false;
      }
      endWord();
      const op = /^[<>]+[&|]?-?/.exec(source.slice(i))?.[0] ?? c;
      i += op.length;
      if (op === "<<" || op === "<<-") {
        const target = /^\s*(['"]?)([^\s'"]+)\1/.exec(source.slice(i));
        if (target !== null) {
          pendingHeredocs.push({ delimiter: target[2] ?? "", stage: stdin });
          i += target[0].length;
        }
      } else if (op.endsWith("&") && /^\d|^-/.test(source.slice(i))) {
        i += /^(\d+|-)/.exec(source.slice(i))?.[0].length ?? 0;
      } else {
        redirect = op === "<" ? "input" : "output";
      }
    } else {
      text += c;
      inWord = true;
      i += 1;
    }
  }
  endPipeline();
  return pipelines;
}

// ---------------------------------------------------------------- judging

/** What a refused command would print, and the file it reads, if any. */
type Finding = { readonly what: string; readonly file?: string };

type Verdict =
  | null
  /** Prints values. `filterable`: a later `cut -d= -f1` leaves only names. */
  | (Finding & { readonly filterable: boolean });

/** One command being judged, with what earlier parts of it did. */
type Judging = {
  readonly env: Env;
  readonly depth: number;
  /** A secrets file it sourced, so its variables now hold values. */
  sourced: string | null;
};

const maxDepth = 6;

const environFile = /\/proc\/[^\s/'"]+\/environ/;

/**
 * A file of secrets by convention: `.env`, `.env.local`, `.dev.vars`,
 * `.envrc`. Not a template: `.env.example`, `.env.sample`.
 */
export function isSecretFile(path: string): boolean {
  const base = path.split("/").at(-1) ?? path;
  if (/\.(example|sample|template|dist)$/.test(base)) {
    return false;
  }
  return /^(\.env|\.dev\.vars)([.*?].*)?$|^\.envrc$/.test(base);
}

/** Commands that print what they read. */
const readers = new Set([
  "cat",
  "tac",
  "less",
  "more",
  "head",
  "tail",
  "bat",
  "batcat",
  "nl",
  "od",
  "xxd",
  "hexdump",
  "strings",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "awk",
  "gawk",
  "mawk",
  "sed",
  "sort",
  "uniq",
  "cut",
  "column",
  "paste",
  "base64",
  "diff",
  "jq",
  "yq",
]);

/** grep and friends print only names of files, counts or nothing. */
const greps = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"]);
const quietGrep =
  /^(-[a-zA-Z]*[lLcq][a-zA-Z]*|--files-with(out)?-match(es)?|--count|--quiet|--silent)$/;

/**
 * Why `command` would print environment values, or null when it wouldn't
 * (as far as this can tell). `env` is Pi's own: a variable it holds is one
 * the command's shell would see.
 */
export function envPrintReason(command: string, env: Env): string | null {
  const found = judge(command, { env, depth: 0, sourced: null });
  return found === null ? null : refusal(found, env["TMX_EXERCISE"]);
}

function judge(command: string, ctx: Judging): Finding | null {
  if (ctx.depth > maxDepth) {
    return null;
  }
  if (environFile.test(command)) {
    return { what: "reading /proc/<pid>/environ" };
  }
  for (const pipeline of parseCommand(command)) {
    for (const [index, stage] of pipeline.entries()) {
      for (const word of stage.words) {
        for (const sub of word.subs) {
          const inner = judge(sub, { ...ctx, depth: ctx.depth + 1 });
          if (inner !== null) {
            return inner;
          }
        }
      }
      const verdict = judgeStage(stage, ctx);
      if (verdict === null) {
        continue;
      }
      if (
        verdict.filterable &&
        pipeline.slice(index + 1).some((later) => keepsNamesOnly(later.words))
      ) {
        continue;
      }
      return verdict;
    }
  }
  return null;
}

function judgeStage(stage: Stage, ctx: Judging): Verdict {
  const words = stage.words.map((w) => w.text);
  let i = 0;
  while (
    i < words.length &&
    (assignment.test(words[i] ?? "") || prefixes.has(words[i] ?? ""))
  ) {
    // `sudo -u x cmd`, `xargs -0 cmd`, `nice -n 5 cmd`: skip their options.
    const prefix = words[i] ?? "";
    i += 1;
    if (
      !["sudo", "doas", "xargs", "nice", "stdbuf", "watch"].includes(prefix)
    ) {
      continue;
    }
    while (i < words.length && (words[i] ?? "").startsWith("-")) {
      const option = words[i] ?? "";
      i += /^-[unIdLsEPn]$/.test(option) ? 2 : 1;
    }
  }
  const head = words[i];
  const cmd = head?.split("/").at(-1) ?? "";
  const rest = stage.words.slice(i + 1);
  const args = rest.map((w) => w.text);
  const shown = [cmd, ...args].join(" ").slice(0, 60);

  // `< .env` into anything but a names-only filter.
  const input = stage.inputs.find(isSecretFile);
  if (input !== undefined && !keepsNamesOnly(stage.words.slice(i))) {
    const what = `${head === undefined ? "" : `${shown} `}< ${input}`;
    return { what: what.slice(0, 60), file: input, filterable: true };
  }
  if (head === undefined) {
    return null;
  }

  switch (cmd) {
    case "env":
      return judgeEnv(rest, stage, ctx);
    case "printenv":
      return { what: shown, filterable: args.length === 0 };
    case "set":
      return args.length === 0 ? { what: "set", filterable: true } : null;
    case "export":
      return args.every((a) => a === "-p")
        ? { what: shown, filterable: true }
        : null;
    case "declare":
    case "typeset": {
      const flags = args.filter((a) => a.startsWith("-")).join("");
      const names = args.filter((a) => !a.startsWith("-"));
      if (/[fF]/.test(flags)) {
        return null;
      }
      if (names.length === 0) {
        return { what: shown, filterable: true };
      }
      // `declare -p NAME` prints it; `declare -x NAME=1` only sets it.
      return flags.includes("p") ? { what: shown, filterable: false } : null;
    }
    case "source":
    case ".": {
      const file = args.find(isSecretFile);
      if (file !== undefined) {
        ctx.sourced = file;
      }
      return null;
    }
    case "eval":
      return asShell(args.join(" "), ctx);
    case "echo":
    case "printf":
    case "print": {
      const vars = rest.flatMap((w) => w.vars);
      // After `source .env`, any of its variables may hold a value.
      if (ctx.sourced !== null && vars.length > 0) {
        return { what: shown, file: ctx.sourced, filterable: false };
      }
      const printed = vars.find(
        (v) =>
          ctx.env[v] !== undefined && !harmless.has(v) && !v.startsWith("LC_")
      );
      return printed === undefined
        ? null
        : { what: `${cmd} $${printed}`, filterable: false };
    }
    default:
      break;
  }
  if (shells.has(cmd)) {
    const c = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
    if (c !== -1) {
      return asShell(args[c + 1] ?? "", ctx);
    }
    const script = args.find((a) => !a.startsWith("-"));
    return script === undefined ? asShell(stage.stdin.join("\n"), ctx) : null;
  }
  if (interpreter.test(cmd)) {
    const code = [...args, ...stage.stdin].join("\n");
    const file = code.match(/[^\s'"`()[\]{},;]+/g)?.find(isSecretFile);
    if (file !== undefined) {
      return { what: shown, file, filterable: false };
    }
    return envInCode.test(code.replace(namesInCode, ""))
      ? { what: shown, filterable: false }
      : null;
  }
  if (readers.has(cmd)) {
    const file = args.find(isSecretFile);
    if (
      file === undefined ||
      keepsNamesOnly(stage.words.slice(i)) ||
      (cmd === "sed" && args.some((a) => /^-[a-zA-Z]*i/.test(a))) ||
      (greps.has(cmd) && args.some((a) => quietGrep.test(a)))
    ) {
      return null;
    }
    return { what: shown, file, filterable: true };
  }
  return null;
}

/** `env [options] [NAME=value...] [command]`: prints values with no command. */
function judgeEnv(rest: readonly Word[], stage: Stage, ctx: Judging): Verdict {
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i]?.text ?? "";
    if (arg === "--") {
      i += 1;
      break;
    }
    if (arg === "-S" || arg === "--split-string") {
      return asShell(rest[i + 1]?.text ?? "", ctx);
    }
    if (arg.startsWith("--split-string=")) {
      return asShell(arg.slice("--split-string=".length), ctx);
    }
    if (
      arg === "-u" ||
      arg === "-C" ||
      arg === "--unset" ||
      arg === "--chdir"
    ) {
      i += 2;
    } else if (arg.startsWith("-") || assignment.test(arg)) {
      i += 1;
    } else {
      break;
    }
  }
  if (i >= rest.length) {
    return { what: "env with no command", filterable: true };
  }
  return judgeStage({ ...stage, words: rest.slice(i) }, ctx);
}

function asShell(script: string, ctx: Judging): Verdict {
  const found = judge(script, { ...ctx, depth: ctx.depth + 1 });
  return found === null ? null : { ...found, filterable: false };
}

// `cut -d= -f1`, `awk -F= '{print $1}'`, `sed 's/=.*//'`, `wc`.
function keepsNamesOnly(stage: readonly Word[]): boolean {
  const [head, ...rest] = stage.map((w) => w.text);
  const args = rest.join(" ");
  switch (head?.split("/").at(-1)) {
    case "cut":
      return (
        /(^| )(-d ?=|--delimiter==)( |$)/.test(args) &&
        /(^| )(-f ?1|--fields=1)( |$)/.test(args)
      );
    case "awk":
    case "gawk":
    case "mawk":
      return (
        /(^| )-F ?=( |$)/.test(args) &&
        rest.some((a) => /^\{\s*print \$1;?\s*\}$/.test(a))
      );
    case "sed":
      return rest.some((a) => /^s(.)=\.\*\1\1g?$/.test(a));
    case "wc":
      return true;
    default:
      return false;
  }
}

export function refusal(found: Finding, exercise: string | undefined): string {
  const id = exercise === undefined || exercise === "" ? "<id>" : exercise;
  const status = `run \`pnpm ex ${id} status\`${id === "<id>" ? " (`pnpm ex` lists the ids)" : ""}`;
  if (found.file !== undefined) {
    return [
      `Refused by the workshop: \`${found.what}\` would print the values in ${found.file}, which hold the guest's keys.`,
      `To see which names it sets, run \`cut -d= -f1 ${found.file}\`.`,
      `For the workshop's own values, ${status}.`,
    ].join(" ");
  }
  return [
    `Refused by the workshop: \`${found.what}\` would print environment values into this session, and env holds the guest's provider keys.`,
    `For the workshop's own values (TMX_SESSION, the exercise, the role, the guest's Pi PID), ${status}.`,
    "To see which variables are set, run `env | cut -d= -f1`.",
  ].join(" ");
}

/**
 * Blocks every bash tool call that would print environment values, and a
 * `read` or `grep` of /proc/<pid>/environ or a secrets file.
 */
export function guardEnv(pi: Hooks, env: Env = process.env): void {
  pi.on("tool_call", (event) => {
    const input = event.input as { command?: unknown; path?: unknown };
    if (
      (event.toolName === "read" || event.toolName === "grep") &&
      typeof input.path === "string"
    ) {
      const found: Finding | null = environFile.test(input.path)
        ? { what: "reading /proc/<pid>/environ" }
        : isSecretFile(input.path)
          ? { what: `${event.toolName} ${input.path}`, file: input.path }
          : null;
      return found === null
        ? undefined
        : { block: true, reason: refusal(found, env["TMX_EXERCISE"]) };
    }
    if (event.toolName !== "bash" || typeof input.command !== "string") {
      return undefined;
    }
    const reason = envPrintReason(input.command, env);
    return reason === null ? undefined : { block: true, reason };
  });
}
