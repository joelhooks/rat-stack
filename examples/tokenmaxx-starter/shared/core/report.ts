import { homedir } from "node:os";
import { styleText } from "node:util";

// How a check command (`done`, 00.1's `check`, a `status` that replays one)
// prints its result. One line per check: the status word at column 0, then
// one plain sentence about what is true now. A FAIL always prints its
// detail, which guests paste into Pi; every other line's detail waits for
// `--details`. NOTE and STRETCH lines sit under "Not required for this
// step:". The closing verdict says done, not done (with a count) or not
// started, and one Next line says what to do. Color only on a terminal with
// NO_COLOR unset, so piped and captured output stays plain.

export type Status = "PASS" | "FAIL" | "NOTE" | "STRETCH";

export const detailsFlag = "--details";

/** Takes `--details` out of a command's args, wherever it is. */
export function takeDetails(args: readonly string[]): {
  readonly details: boolean;
  readonly rest: readonly string[];
} {
  return {
    details: args.includes(detailsFlag),
    rest: args.filter((arg) => arg !== detailsFlag),
  };
}

/** Color on a terminal, unless NO_COLOR is set to anything. */
export function colorFor(
  stream: { readonly isTTY?: boolean } = process.stdout,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return stream.isTTY === true && (env["NO_COLOR"] ?? "") === "";
}

/** `path` with the home folder shown as `~`. */
export function shortPath(path: string, home = homedir()): string {
  return home !== "" && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;
}

const statusWidth = "STRETCH  ".length;
const detailIndent = " ".repeat(statusWidth);
const width = 80;

/** `pnpm` and the word after it, as one word: a command isn't split. */
function keepTogether(words: readonly string[]): string[] {
  const kept: string[] = [];
  for (const word of words) {
    if (kept.at(-1) === "pnpm") {
      kept[kept.length - 1] = `pnpm ${word}`;
    } else {
      kept.push(word);
    }
  }
  return kept;
}

/**
 * `text` broken between words: a first line of at most `first` columns, then
 * lines of at most `rest` that start with `indent`. A word longer than a line
 * stays whole.
 */
export function wrap(
  text: string,
  first: number,
  indent: string,
  rest = width - indent.length
): string[] {
  const lines: string[] = [];
  let line = "";
  let room = first;
  for (const word of keepTogether(text.split(" "))) {
    if (line !== "" && line.length + 1 + word.length > room) {
      lines.push(line);
      line = word;
      room = rest;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : `${indent}${l}`));
}

/**
 * A detail line as a sentence: a capital when it starts with a plain word,
 * a full stop when it ends in one. A line that starts with a name or a
 * command, or ends with a path, stays as it is: it's typed as it stands.
 */
export function asSentence(line: string): string {
  const capital =
    /^[a-z][a-z']*\b(?![-_.:/\d])/.test(line) &&
    !/^(git|pnpm|npm|npx|node|pi|tsc)\b/.test(line)
      ? `${line.charAt(0).toUpperCase()}${line.slice(1)}`
      : line;
  const last = capital.split(" ").at(-1) ?? "";
  return /[a-z0-9)]$/i.test(capital) &&
    !/[.!?]\)$/.test(capital) &&
    !last.includes("/")
    ? `${capital}.`
    : capital;
}

/** Words only, in lower case, for telling whether two lines say the same. */
const bare = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/\bthere(?:'s| is) /g, "")
    .replaceAll(/\b(?:has|have) been /g, "")
    .replaceAll(/[^a-z0-9 ]/g, "")
    .replaceAll(/ +/g, " ")
    .trim();

/**
 * True when `text` already says all of `line`, a line of four words or more:
 * a shorter one, a name or an id say, is worth keeping.
 */
export function saidIn(text: string, line: string): boolean {
  const words = bare(line);
  return words.split(" ").length >= 4 && bare(text).includes(words);
}

/** A check's two sentences: when it holds, and when it doesn't. */
export type Says = { readonly yes: string; readonly no: string };

/** A check's sentence from `table`, by its name. An unknown name as it is. */
export function sentence(
  table: Readonly<Record<string, Says>>,
  name: string,
  ok: boolean
): string {
  const says = table[name];
  return says === undefined ? name : ok ? says.yes : says.no;
}

/** The exercises in the order a guest does them, for the Next line. */
export const exerciseOrder: readonly (readonly [id: string, title: string])[] =
  [
    ["00.1", "Check your Pi"],
    ["01.1", "Don't take its word for it"],
    ["02.1", "Wake me when it's done"],
    ["02.2", "Survive a quit"],
    ["03.1", "Yesterday's mistake"],
    ["04.1", "No copy and paste"],
    ["05.1", "Who needs me"],
    ["06.1", "Split three ways"],
  ];

/**
 * What a done exercise's Next line says: the next one and its setup. `where`
 * names the folder to run it in, when that isn't the one the guest is in.
 */
export function nextAfter(id: string, where?: string): string {
  const at = exerciseOrder.findIndex(([each]) => each === id);
  const next = at === -1 ? undefined : exerciseOrder[at + 1];
  if (next === undefined) {
    return "nothing. That was the last exercise.";
  }
  const [nextId, title] = next;
  return where === undefined
    ? `${nextId} · ${title}. Start it with: pnpm ex ${nextId} setup`
    : `${nextId} · ${title}, in ${where}: pnpm ex ${nextId} setup`;
}

/** A check's sentence: its own, or else `table`'s for its name. */
export function saysOf(
  table: Readonly<Record<string, Says>>,
  claim: {
    readonly name: string;
    readonly ok: boolean;
    readonly says?: string | undefined;
  }
): string {
  return claim.says ?? sentence(table, claim.name, claim.ok);
}

/**
 * `Next: ...` in 80 columns. Too long, a command at its end goes on a line
 * of its own rather than broken in two.
 */
function nextLines(next: string): string[] {
  const line = `Next: ${next}`;
  const at = line.lastIndexOf(": pnpm ");
  if (line.length <= width || at === -1) {
    return wrap(line, width, "      ");
  }
  return [
    ...wrap(line.slice(0, at + 1), width, "      "),
    `      ${line.slice(at + 2)}`,
  ];
}

/** The Next line after a FAIL when the FAILs don't share one fix. */
export const pasteFails =
  "paste the FAIL lines into Pi and ask it to fix them, then run this again.";

const colors: Record<Status, Parameters<typeof styleText>[0]> = {
  PASS: "green",
  FAIL: "red",
  NOTE: "dim",
  STRETCH: "cyan",
};

export type Reporter = {
  /** `01.1 · Don't take its word · checking ~/Code/app`. */
  readonly header: (what?: string) => void;
  /**
   * One check: its status and sentence, then its detail when it shows. A
   * FAIL's `fix` is what to do about it, when that's one plain step; when
   * every FAIL has the same one, it becomes the Next line.
   */
  readonly check: (
    status: Status,
    sentence: string,
    detail?: string,
    fix?: string
  ) => void;
  /** A line under the checks, e.g. a judge's `Note: ...`. Dim. */
  readonly aside: (text: string) => void;
  /** Any other line, as it is. Every line after the header goes through here. */
  readonly line: (text: string) => void;
  /**
   * The closing lines when every PASS/FAIL check passed: the verdict, after a
   * blank line and bold, then `Next: ${next}` when there is one.
   */
  readonly done: (text: string, next?: string) => void;
  /**
   * Closing lines in words of their own: a step set up with nothing done
   * yet, say, or a check that couldn't run.
   */
  readonly end: (text: string, next: string) => void;
  /**
   * The closing lines when a check failed: `Not done yet: 2 of 4 checks
   * pass.`, then
   * the FAILs' shared fix as the Next line, or else `otherwise`, which is
   * `pasteFails` unless given. `words` replaces "Not done yet".
   */
  readonly notDone: (opts?: {
    readonly words?: string;
    readonly otherwise?: string;
  }) => void;
  /** The one closing line for a step nobody has set up yet. */
  readonly notStarted: (setup: string) => void;
  /**
   * Runs one slow step under a progress line saying what it waits on. On a
   * terminal the line shows only while `step` runs, and is cleared however
   * it ends; otherwise nothing prints.
   */
  readonly during: <A>(label: string, step: () => A | Promise<A>) => Promise<A>;
};

export type ReporterOptions = {
  readonly id: string;
  readonly title: string;
  /** The command that shows every detail, e.g. `pnpm ex 01.1 done --details`. */
  readonly command: string;
  readonly details: boolean;
  readonly color?: boolean;
  /** Where a progress line goes. Only used with color. */
  readonly write?: (text: string) => void;
};

export function reporter(
  out: (line: string) => void,
  opts: ReporterOptions
): Reporter {
  const color = opts.color ?? colorFor();
  const write = opts.write ?? ((text) => process.stdout.write(text));
  const paint = (format: Parameters<typeof styleText>[0], text: string) =>
    color ? styleText(format, text, { validateStream: false }) : text;
  let progressShown = false;
  const clearProgress = () => {
    if (progressShown) {
      write("\r\u001b[2K");
      progressShown = false;
    }
  };
  let hidden = false;
  let checks = 0;
  let passed = 0;
  let optional = false;
  const fixes: (string | undefined)[] = [];
  let blank = false;
  const print = (line: string) => {
    clearProgress();
    out(line);
    blank = line === "";
  };
  // A blank line before the closing lines, unless one is there already.
  const gap = () => {
    if (!blank) {
      print("");
    }
  };
  const close = (verdict: string, next?: string) => {
    gap();
    for (const line of wrap(verdict, width, "")) {
      print(paint("bold", line));
    }
    for (const line of next === undefined ? [] : nextLines(next)) {
      print(line);
    }
    if (hidden) {
      print(paint("dim", `More: ${opts.command}`));
    }
  };
  return {
    header: (what) => {
      const name = `${opts.id} · ${opts.title}`;
      // Past 80 columns, what's being checked (a long path, say) gets its
      // own line rather than wrapping.
      if (what === undefined) {
        print(paint("bold", name));
      } else if (name.length + what.length + 3 <= 80) {
        print(paint("bold", `${name} · ${what}`));
      } else {
        print(paint("bold", name));
        print(what);
      }
    },
    check: (status, title, detail, fix) => {
      if (status === "PASS" || status === "FAIL") {
        checks += 1;
        passed += status === "PASS" ? 1 : 0;
        if (status === "FAIL") {
          fixes.push(fix);
        }
      } else if (!optional) {
        optional = true;
        print("");
        print("Not required for this step:");
      }
      const [first = "", ...rest] = wrap(
        title,
        width - statusWidth,
        detailIndent
      );
      print(`${paint(colors[status], status.padEnd(statusWidth))}${first}`);
      for (const line of rest) {
        print(line);
      }
      // A detail line the sentence already says adds nothing.
      const lines = (detail?.trim() ?? "")
        .split("\n")
        .filter((line) => line.trim() !== "" && !saidIn(title, line));
      if (lines.length === 0) {
        return;
      }
      if (status !== "FAIL" && !opts.details) {
        hidden = true;
        return;
      }
      for (const line of lines) {
        const room = width - statusWidth;
        for (const part of wrap(asSentence(line), room, "", room)) {
          const indented = `${detailIndent}${part}`;
          print(status === "FAIL" ? indented : paint("dim", indented));
        }
      }
    },
    aside: (text) => print(paint("dim", text)),
    line: (text) => print(text),
    done: (text, next) => close(text, next),
    end: (text, next) => close(text, next),
    notDone: (o = {}) => {
      const [fix] = fixes;
      const shared =
        fix !== undefined && fixes.every((f) => f === fix) ? fix : undefined;
      close(
        `${o.words ?? "Not done yet"}: ${passed} of ${checks} checks pass.`,
        shared ?? o.otherwise ?? pasteFails
      );
    },
    notStarted: (setup) => {
      gap();
      print(paint("bold", `Not started. Start it with: ${setup}`));
    },
    during: async (label, step) => {
      if (color) {
        clearProgress();
        // One screen line, or clearing it would leave the wrapped rest behind.
        const columns = (process.stdout.columns ?? 80) - 1;
        const line =
          label.length > columns ? `${label.slice(0, columns - 3)}...` : label;
        write(paint("dim", line));
        progressShown = true;
      }
      try {
        return await step();
      } finally {
        clearProgress();
      }
    },
  };
}
