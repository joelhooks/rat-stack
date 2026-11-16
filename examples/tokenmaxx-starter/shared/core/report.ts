import { homedir } from "node:os";
import { styleText } from "node:util";

// How a check command (`done`, 00.1's `check`, a `status` that replays one)
// prints its result. One line per check: the status word at column 0, then
// the check's title. A FAIL always prints its detail, which guests paste into
// Pi; every other line's detail waits for `--details`. Color only on a
// terminal with NO_COLOR unset, so piped and captured output stays plain.

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

const colors: Record<Status, Parameters<typeof styleText>[0]> = {
  PASS: "green",
  FAIL: "red",
  NOTE: "dim",
  STRETCH: "cyan",
};

export type Reporter = {
  /** `01.1 · Don't take its word · checking ~/Code/app`. */
  readonly header: (what?: string) => void;
  /** One check: its status and title, then its detail when it shows. */
  readonly check: (status: Status, title: string, detail?: string) => void;
  /** A line under the checks, e.g. a judge's `Note: ...`. Dim. */
  readonly aside: (text: string) => void;
  /** Any other line, as it is. Every line after the header goes through here. */
  readonly line: (text: string) => void;
  /** The closing verdict, after a blank line. Bold. */
  readonly verdict: (text: string) => void;
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
  const print = (line: string) => {
    clearProgress();
    out(line);
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
    check: (status, title, detail) => {
      print(`${paint(colors[status], status.padEnd(statusWidth))}${title}`);
      const text = detail?.trim() ?? "";
      if (text === "") {
        return;
      }
      if (status !== "FAIL" && !opts.details) {
        hidden = true;
        return;
      }
      for (const line of text.split("\n")) {
        const indented = `${detailIndent}${line}`;
        print(status === "FAIL" ? indented : paint("dim", indented));
      }
    },
    aside: (text) => print(paint("dim", text)),
    line: (text) => print(text),
    verdict: (text) => {
      print("");
      print(paint("bold", text));
      if (hidden) {
        print(paint("dim", `More: ${opts.command}`));
      }
    },
    during: async (label, step) => {
      if (color) {
        clearProgress();
        // One screen line, or clearing it would leave the wrapped rest behind.
        const width = (process.stdout.columns ?? 80) - 1;
        const line =
          label.length > width ? `${label.slice(0, width - 3)}...` : label;
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
