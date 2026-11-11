const VCS_COMMAND =
  /(?:^|[\s;&|()])(?:[^\s;&|()]*\/)?(?:git|jj)(?=$|[\s;&|()])/mu;

export const NONINTERACTIVE_VCS_ENV =
  "export GIT_EDITOR=: GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no JJ_EDITOR=:\n";

export const HOOK_BYPASS_REASON =
  "Blocked hook bypass: this command skips or disables the Git hooks. The hooks run `pnpm check` and `pnpm test`, the fence every commit must pass. Fix: drop the bypass (`--no-verify`, `git commit -n`, `LEFTHOOK=0`, `core.hooksPath`, or an edit under `.git/hooks`), read the hook output, and fix the failure; ask the owner before changing `lefthook.yml`.";

const SEGMENT_BREAKS = new Set([";", "&", "|", "(", ")", "`", "\n"]);

const REDIRECTS = new Set([">", ">>", ">|"]);

const SHELLS = new Set(["bash", "dash", "ksh", "sh", "zsh"]);

const WRAPPERS = new Set(["command", "env", "exec", "nohup", "sudo", "time"]);

const HOOK_READERS = new Set([
  "[",
  "bat",
  "cat",
  "diff",
  "file",
  "grep",
  "head",
  "less",
  "ls",
  "more",
  "rg",
  "stat",
  "tail",
  "test",
  "tree",
  "wc",
]);

const GIT_GLOBALS_WITH_VALUE = new Set([
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
  "-C",
]);

const COMMIT_SHORT_WITH_VALUE = new Set(["C", "F", "c", "m", "t"]);

const COMMIT_LONG_WITH_VALUE = new Set([
  "--author",
  "--cleanup",
  "--date",
  "--file",
  "--fixup",
  "--message",
  "--pathspec-from-file",
  "--reedit-message",
  "--reuse-message",
  "--squash",
  "--template",
  "--trailer",
]);

const CONFIG_READS = new Set([
  "--get",
  "--get-all",
  "--get-regexp",
  "--list",
  "--show-origin",
  "--unset",
  "--unset-all",
  "-l",
  "get",
  "list",
  "unset",
]);

const NO_VERIFY = "--no-verify";

const NO_VERIFY_SHORTEST_PREFIX = "--no-veri".length;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** @typedef {{ text: string; operator: boolean; assignable: boolean }} Token */

/** @typedef {{ action: "allow"; command: string } | { action: "block"; reason: string }} CommandPolicyResult */

/**
 * @param {string} command
 * @returns {Token[][]}
 */
const segmentsOf = (command) => {
  /** @type {Token[][]} */
  const segments = [[]];
  let text = "";
  let started = false;
  let assignable = true;
  /** @type {"'" | "\"" | null} */
  let quote = null;

  const current = () => segments.at(-1) ?? [];

  const finish = () => {
    if (started) {
      current().push({ assignable, operator: false, text });
    }

    text = "";
    started = false;
    assignable = true;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index);

    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && index + 1 < command.length) {
        index += 1;
        text += command.charAt(index);
      } else {
        text += char;
      }
    } else if (char === "'" || char === '"') {
      if (!started) {
        assignable = false;
      }

      quote = char;
      started = true;
    } else if (char === "\\" && index + 1 < command.length) {
      index += 1;
      text += command.charAt(index);
      started = true;
    } else if (/\s/u.test(char) && char !== "\n") {
      finish();
    } else if (SEGMENT_BREAKS.has(char)) {
      finish();
      segments.push([]);
    } else if (char === ">") {
      finish();
      const next = command.charAt(index + 1);
      const operator = next === ">" || next === "|" ? `>${next}` : ">";
      index += operator.length - 1;
      current().push({ assignable: false, operator: true, text: operator });
    } else {
      text += char;
      started = true;
    }
  }

  finish();

  return segments.filter((segment) => segment.length > 0);
};

/**
 * @param {string} word
 * @returns {string}
 */
const basename = (word) => word.slice(word.lastIndexOf("/") + 1);

/**
 * @param {Token} token
 * @returns {boolean}
 */
const disablesHooks = (token) => {
  if (!token.assignable || !ASSIGNMENT.test(token.text)) {
    return false;
  }

  const [name = "", ...rest] = token.text.split("=");
  const value = rest.join("=").trim().toLowerCase();

  return (
    (name === "LEFTHOOK" && (value === "0" || value === "false")) ||
    (name === "HUSKY" && value === "0") ||
    (name === "LEFTHOOK_EXCLUDE" && value !== "")
  );
};

/**
 * @param {Token[]} words
 * @returns {Token[]}
 */
const withoutPrefixes = (words) => {
  const index = words.findIndex(
    (token) =>
      !(token.assignable && ASSIGNMENT.test(token.text)) &&
      !WRAPPERS.has(basename(token.text))
  );

  return index === -1 ? [] : words.slice(index);
};

/**
 * @param {string} arg
 * @returns {boolean}
 */
const isNoVerify = (arg) =>
  arg.length >= NO_VERIFY_SHORTEST_PREFIX && NO_VERIFY.startsWith(arg);

/**
 * @param {string} setting
 * @returns {boolean}
 */
const setsHooksPath = (setting) =>
  setting.split("=")[0]?.trim().toLowerCase() === "core.hookspath";

/**
 * @param {string[]} args
 * @returns {boolean}
 */
const commitSkipsHooks = (args) => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";

    if (arg === "--") {
      return false;
    }

    if (isNoVerify(arg)) {
      return true;
    }

    if (COMMIT_LONG_WITH_VALUE.has(arg)) {
      index += 1;
    } else if (/^-[^-]/u.test(arg)) {
      for (let flag = 1; flag < arg.length; flag += 1) {
        const char = arg.charAt(flag);

        if (char === "n") {
          return true;
        }

        if (COMMIT_SHORT_WITH_VALUE.has(char)) {
          if (flag === arg.length - 1) {
            index += 1;
          }

          break;
        }
      }
    }
  }

  return false;
};

/**
 * @param {string[]} args
 * @returns {boolean}
 */
const configSetsHooksPath = (args) => {
  const key = args.findIndex(setsHooksPath);

  if (key === -1) {
    return false;
  }

  if (args.some((arg) => CONFIG_READS.has(arg))) {
    return false;
  }

  return (args[key] ?? "").includes("=") || key < args.length - 1;
};

/**
 * @param {string[]} args
 * @returns {boolean}
 */
const gitSkipsHooks = (args) => {
  let index = 0;

  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    const option = args[index] ?? "";

    if (option === "-c") {
      if (setsHooksPath(args[index + 1] ?? "")) {
        return true;
      }

      index += 2;
    } else if (option.startsWith("-c") && option.length > 2) {
      if (setsHooksPath(option.slice(2))) {
        return true;
      }

      index += 1;
    } else if (option.startsWith("--config-env=")) {
      if (setsHooksPath(option.slice("--config-env=".length))) {
        return true;
      }

      index += 1;
    } else {
      index += GIT_GLOBALS_WITH_VALUE.has(option) ? 2 : 1;
    }
  }

  const [subcommand = "", ...rest] = args.slice(index);

  if (subcommand === "commit") {
    if (commitSkipsHooks(rest)) {
      return true;
    }
  } else if (rest.some(isNoVerify)) {
    return true;
  }

  return subcommand === "config" && configSetsHooksPath(rest);
};

/**
 * @param {Token[]} segment
 * @returns {boolean}
 */
const touchesHooksDirectory = (segment) => {
  const words = withoutPrefixes(segment.filter((token) => !token.operator));
  const program = basename(words[0]?.text ?? "");

  return segment.some((token, index) => {
    if (!token.text.includes(".git/hooks") || token.operator) {
      return false;
    }

    const previous = segment[index - 1];

    return (
      (previous !== undefined &&
        previous.operator &&
        REDIRECTS.has(previous.text)) ||
      !HOOK_READERS.has(program)
    );
  });
};

/**
 * @param {Token[]} segment
 * @param {(command: string) => boolean} nested
 * @returns {boolean}
 */
const segmentSkipsHooks = (segment, nested) => {
  if (segment.some(disablesHooks) || touchesHooksDirectory(segment)) {
    return true;
  }

  const words = withoutPrefixes(segment.filter((token) => !token.operator));
  const [program, ...args] = words.map((token) => token.text);
  const name = basename(program ?? "");

  if (name === "git") {
    return gitSkipsHooks(args);
  }

  if (name === "export") {
    return words.slice(1).some(disablesHooks);
  }

  if (args.includes("lefthook") || name === "lefthook") {
    const lefthook = name === "lefthook" ? -1 : args.indexOf("lefthook");

    return args.slice(lefthook + 1).includes("uninstall");
  }

  if (SHELLS.has(name)) {
    const script = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/u.test(arg));

    return script !== -1 && nested(args[script + 1] ?? "");
  }

  return false;
};

/**
 * @param {string} command
 * @returns {boolean}
 */
const skipsHooks = (command) =>
  segmentsOf(command).some((segment) => segmentSkipsHooks(segment, skipsHooks));

/**
 * @param {string} command
 * @returns {CommandPolicyResult}
 */
export const applyCommandPolicy = (command) => {
  if (skipsHooks(command)) {
    return { action: "block", reason: HOOK_BYPASS_REASON };
  }

  if (!VCS_COMMAND.test(command)) {
    return { action: "allow", command };
  }

  return {
    action: "allow",
    command: `${NONINTERACTIVE_VCS_ENV}${command}`,
  };
};
