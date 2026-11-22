import { type Job, ownedPath, ownerOf, type PartId, partIds } from "./job.ts";
import type { Facts, SeenStamp } from "./observe.ts";
import { liarBlobs } from "./observe.ts";

// The 06.1 done check's rules. Pure: given what `observe` saw, which claims
// hold. None of them knows how the guest's boss splits, copies, judges or
// keeps work; they read the stamps the workers left and the guest's repo.

export type Claim = {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** What `done` prints for this case, when it's more than the name says. */
  readonly says?: string;
};

export const claimNames = {
  copies: "each part was done by a worker in its own copy",
  owned: "no worker changed another part's file",
  merged: "parts a and b are in your repo",
  refused: "part c, reported done, was turned down",
  kept: "part c's work was kept when its worker closed",
} as const;

/** What `done` prints for each check when the case adds nothing. */
export const says = {
  [claimNames.copies]: {
    yes: "Each part was done by a worker in its own copy.",
    no: "Not every part was done by a worker in its own copy.",
  },
  [claimNames.owned]: {
    yes: "No worker changed another part's file.",
    no: "A worker changed another part's file.",
  },
  [claimNames.merged]: {
    yes: "Parts a and b are in your repo.",
    no: "Parts a and b aren't both in your repo as their workers left them.",
  },
  [claimNames.refused]: {
    yes: "Part c, reported done, was turned down.",
    no: "Part c, reported done, got into your repo.",
  },
  [claimNames.kept]: {
    yes: "Part c's work was kept when its worker closed.",
    no: "Part c's work was lost when its worker closed.",
  },
};

const byPart = (stamps: readonly SeenStamp[], part: PartId) =>
  stamps.filter((s) => s.part === part);

/** `a`, `a or b`, `a, b or c`. */
const orList = (ids: readonly string[]) =>
  ids.length <= 1
    ? ids.join("")
    : `${ids.slice(0, -1).join(", ")} or ${ids.at(-1) ?? ""}`;

const stampHint = "each worker's last step is the stamp command in the job";

function copies(facts: Facts): Claim {
  const name = claimNames.copies;
  const missing = partIds.filter((id) => byPart(facts.stamps, id).length === 0);
  if (missing.length > 0) {
    return {
      name,
      ok: false,
      says: `No worker has stamped part ${orList(missing)} yet.`,
      detail: `No worker stamped part ${orList(missing)}: ${stampHint}.`,
    };
  }
  const problems: string[] = [];
  for (const stamp of facts.stamps) {
    if (stamp.inGuest || stamp.copyRoot === facts.job.guestRoot) {
      problems.push(
        `Part ${stamp.part}'s worker worked in your repo itself (${stamp.copyRoot}), not a copy of it.`
      );
    }
  }
  const owners = new Map<string, Set<PartId>>();
  for (const stamp of facts.stamps) {
    const key = `${stamp.copyRoot}\0${stamp.copyId}`;
    owners.set(key, (owners.get(key) ?? new Set()).add(stamp.part));
  }
  for (const [key, shared] of owners) {
    if (shared.size > 1) {
      problems.push(
        `Parts ${[...shared].join(" and ")} were done in the same copy, ${key.split("\0")[0]}.`
      );
    }
  }
  if (problems.length > 0) {
    return { name, ok: false, detail: problems.join("\n") };
  }
  return {
    name,
    ok: true,
    detail: partIds
      .map((id) => {
        const roots = [
          ...new Set(byPart(facts.stamps, id).map((s) => s.copyRoot)),
        ];
        return `${id}: ${roots.join(", ")}`;
      })
      .join("\n"),
  };
}

/**
 * Files a stamp's worker changed: in its copy's job folder, different from
 * the job folder at setup. Files gone from the copy aren't counted.
 */
const changedBy = (facts: Facts, stamp: SeenStamp) =>
  Object.entries(stamp.files)
    .filter(([path, blob]) => facts.base[path] !== blob)
    .map(([path, blob]) => ({ path, blob }));

function owned(facts: Facts): Claim {
  const name = claimNames.owned;
  if (facts.stamps.length === 0) {
    return {
      name,
      ok: false,
      says: "No worker has stamped a part yet.",
      detail: `No stamps yet: ${stampHint}.`,
    };
  }
  const problems: string[] = [];
  for (const stamp of facts.stamps) {
    for (const { path, blob } of changedBy(facts, stamp)) {
      const owner = ownerOf(facts.job, path);
      if (owner === null || owner === stamp.part) {
        continue;
      }
      // The owner's own result, carried into a copy made after it landed.
      const owners = byPart(facts.stamps, owner);
      if (owners.some((s) => s.files[path] === blob)) {
        continue;
      }
      problems.push(
        `Part ${stamp.part}'s worker changed ${path}, which part ${owner} owns (copy ${stamp.copyRoot}).`
      );
    }
  }
  return problems.length > 0
    ? { name, ok: false, detail: [...new Set(problems)].join("\n") }
    : {
        name,
        ok: true,
        detail: `Every part's file was changed only by that part's worker, across ${facts.stamps.length} stamp${facts.stamps.length === 1 ? "" : "s"}.`,
      };
}

function merged(facts: Facts): Claim {
  const name = claimNames.merged;
  const problems: string[] = [];
  for (const id of ["a", "b"] as const) {
    const path = ownedPath(facts.job, id);
    const blob = facts.tree[path] ?? null;
    const stamped = byPart(facts.stamps, id).map((s) => s.files[path]);
    if (blob === null) {
      problems.push(`${path} isn't in your repo.`);
    } else if (!stamped.includes(blob)) {
      problems.push(
        stamped.length === 0
          ? `${path} is in your repo, but no worker stamped part ${id}.`
          : `${path} in your repo isn't what part ${id}'s worker stamped. A worker stamps last, after its final change.`
      );
    }
  }
  return problems.length > 0
    ? { name, ok: false, detail: problems.join("\n") }
    : {
        name,
        ok: true,
        detail: `${ownedPath(facts.job, "a")} and ${ownedPath(facts.job, "b")} in your working tree are what their workers stamped.`,
      };
}

const noLiar = (job: Job) =>
  `Part c was never done by the scripted worker, so no worker has reported done on it yet. Have your boss run it as part c's worker, inside that worker's copy: see \`pnpm ex 06.1 job\`. (${ownedPath(job, "c")} has a type error.)`;

function refused(facts: Facts): Claim {
  const name = claimNames.refused;
  const job = facts.job;
  const blobs = liarBlobs(job, facts.stamps);
  if (blobs.length === 0) {
    return {
      name,
      ok: false,
      says: "No worker has reported part c done yet.",
      detail: noLiar(job),
    };
  }
  const path = ownedPath(job, "c");
  const reached: string[] = [];
  if (blobs.includes(facts.tree[path] ?? "")) {
    reached.push("your working tree");
  }
  if (blobs.includes(facts.index[path] ?? "")) {
    reached.push("your index (staged)");
  }
  if (facts.onBranch.length > 0) {
    reached.push(`a commit on ${facts.branch}`);
  }
  if (reached.length > 0) {
    return {
      name,
      ok: false,
      detail: [
        `The scripted worker reported part c done, and its ${path} reached ${reached.join(", ")}.`,
        `If your floor let it through, your floor doesn't check ${job.dir}/: run \`pnpm ex 06.1 setup <folder>\` with a folder it checks.`,
      ].join("\n"),
    };
  }
  return {
    name,
    ok: true,
    detail: `The scripted worker reported done; its ${path} is not in your working tree, your index or ${facts.branch}.`,
  };
}

function kept(facts: Facts): Claim {
  const name = claimNames.kept;
  const job = facts.job;
  const liars = facts.stamps.filter((s) => s.scripted && s.part === "c");
  if (liars.length === 0) {
    // The line above says why; this one adds nothing to paste.
    return {
      name,
      ok: false,
      says: "Part c has no worker yet, so there's no closing to check.",
      detail: "",
    };
  }
  const open = [...new Set(liars.filter((s) => s.open).map((s) => s.copyRoot))];
  if (open.length > 0) {
    return {
      name,
      ok: false,
      says: "Part c's worker hasn't been closed yet.",
      detail: `Part c's worker hasn't been closed: its copy is still at ${open.join(", ")}. Close it the way your boss closes workers, then check again.`,
    };
  }
  const places = liarBlobs(job, liars).flatMap(
    (blob) => facts.kept[blob] ?? []
  );
  if (places.length === 0) {
    return {
      name,
      ok: false,
      detail: `Part c's ${ownedPath(job, "c")} is in no ref, stash or patch file in your repo, so it was lost when its copy closed.`,
    };
  }
  return {
    name,
    ok: true,
    detail: `Its copy is gone, and its ${ownedPath(job, "c")} is kept in ${[...new Set(places)].join(", ")}.`,
  };
}

export function judge(facts: Facts): Claim[] {
  return [
    copies(facts),
    owned(facts),
    merged(facts),
    refused(facts),
    kept(facts),
  ];
}
