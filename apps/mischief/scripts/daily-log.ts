import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export interface LogPage {
  readonly sourcePath: string;
  readonly routePath: string;
  readonly title: string;
}

const repository = "https://github.com/joelhooks/rat-stack";

const contentPath =
  /^(?:\.brain\/(?:resources|areas)\/|skills\/)[\w./-]+$|^(?:VISION|AGENTS|README)\.md$/u;

const publicLabel = (text: string) =>
  text
    .replaceAll(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu, "[email omitted]")
    .replaceAll(
      /(?:\/(?:Users|home|private|tmp|Volumes)\/|[A-Z]:\\)[^\s]+/gu,
      "[path omitted]"
    )
    .replaceAll(
      /[\\`*_[\]{}<>]/gu,
      (character) => `&#${character.codePointAt(0)};`
    );

export const dailyLogMarkdown = (
  history: string,
  pages: readonly LogPage[],
  unavailable?: string
) => {
  const bySource = new Map(pages.map((page) => [page.sourcePath, page]));

  const entries = history
    .split("\u001E")
    .flatMap((record) => {
      const [header = "", ...changes] = record.trim().split("\n");

      const match =
        /^(?<hash>[a-f0-9]{40})\t(?<day>\d{4}-\d{2}-\d{2})\t(?<time>\d+)\t(?<parents>[a-f0-9 ]*)\t(?<subject>.*)$/u.exec(
          header
        );

      const fields = match?.groups;

      if (
        !fields ||
        (fields.parents ?? "").split(" ").filter(Boolean).length > 1
      ) {
        return [];
      }

      return changes.flatMap((change) => {
        const [status, sourcePath] = change.split("\t");

        if (
          sourcePath === undefined ||
          sourcePath === "" ||
          !contentPath.test(sourcePath) ||
          !["A", "M", "T", "D"].includes(status ?? "")
        ) {
          return [];
        }

        const page = status === "D" ? undefined : bySource.get(sourcePath);

        const title = publicLabel(
          page?.title ?? sourcePath.split("/").at(-1) ?? "Content page"
        );

        const revision =
          status === "D" ? fields.parents?.split(" ")[0] : fields.hash;

        const href =
          page?.routePath ?? `${repository}/blob/${revision}/${sourcePath}`;

        return [
          {
            day: fields.day ?? "",
            hash: fields.hash ?? "",
            line: `- [${title}](${href}) — ${status === "A" ? "new page" : "edited"}: [${publicLabel(fields.subject ?? "")}](${repository}/commit/${fields.hash})`,
            time: Number(fields.time),
          },
        ];
      });
    })
    .toSorted(
      (left, right) =>
        right.day.localeCompare(left.day) ||
        right.time - left.time ||
        left.hash.localeCompare(right.hash)
    );

  const days = new Map<string, string[]>();

  for (const entry of entries) {
    const lines = days.get(entry.day) ?? [];
    lines.push(entry.line);
    days.set(entry.day, lines);
  }

  const note =
    unavailable ??
    (days.size === 0
      ? "No content history was available when this build ran."
      : undefined);

  return [
    "# Change log",
    "",
    "Content changes by commit date, newest first. Generated from git history at build time; merge commits are omitted.",
    "",
    ...(note === undefined
      ? [...days].flatMap(([day, lines]) => [`## ${day}`, "", ...lines, ""])
      : [note]),
  ].join("\n");
};

export const readDailyLog = Effect.fn("readDailyLog")(
  function* readHistory(root: string, pages: readonly LogPage[]) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const shallow = yield* spawner.string(
      ChildProcess.make("git", ["rev-parse", "--is-shallow-repository"], {
        cwd: root,
      })
    );

    if (shallow.trim() === "true") {
      return dailyLogMarkdown(
        "",
        pages,
        "Content history is unavailable: this build has a shallow checkout. Build from a full git checkout (fetch-depth: 0) to populate the log."
      );
    }

    if (shallow.trim() !== "false") {
      return dailyLogMarkdown(
        "",
        pages,
        "Content history is unavailable: git or its history could not be read in this build. Build from a full git checkout to populate the log."
      );
    }

    const history = yield* spawner.string(
      ChildProcess.make(
        "git",
        [
          "log",
          "--no-merges",
          "--full-history",
          "--no-renames",
          "--name-status",
          "--format=%x1e%H%x09%cs%x09%ct%x09%P%x09%s",
          "--",
          ".brain/resources",
          ".brain/areas",
          "skills",
          "VISION.md",
          "AGENTS.md",
          "README.md",
        ],
        { cwd: root }
      )
    );

    return dailyLogMarkdown(history, pages);
  },
  Effect.orElseSucceed(() =>
    dailyLogMarkdown(
      "",
      [],
      "Content history is unavailable: git or its history could not be read in this build. Build from a full git checkout to populate the log."
    )
  )
);
