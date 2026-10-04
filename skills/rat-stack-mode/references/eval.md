# Router planning eval

The router improves measurement order and storage checks in these probes. It also increases reading cost. The first nightly-report plan is worse than baseline. Repairs remove its reporting gate and forced store reuse.

## Method

Date: 2026-10-04.

Run each task with a fresh process:

```sh
pi -p --no-session -ne --model openai-codex/gpt-6.1-sol:medium --tools read,bash --mode json "<prompt>"
```

- Baseline uses a clean clone of origin/main at `2cd84f9ba72a8576f6c542f36d7f450b2da7dbe1`.
- Router runs use the working branch. Prefix each prompt with `Start with skills/rat-stack-mode/SKILL.md.`
- Both variants allow only planning, read, and side-effect-free bash. Prompts forbid edits, installs, commits, deployments, and process startup.
- Require a final list of opened skills and principles, with decisions they changed.
- Score observed tool calls and final plans, not claimed file reads alone.
- Record actual model metadata. Every scored run uses `openai-codex/gpt-6.1-sol` with medium thinking and exits successfully.
- Keep raw traces local. This report contains only task prompts, public repo paths, hashes, and derived findings.

Three baseline runs and eight router runs complete. Three router pilots run during publication-link repair and remain unscored.

Three fresh router runs test the repaired pointers. Two further runs test the behavioral repairs below. The comparison uses three baseline plans, the repaired-pointer history plan, and the two revised plans.

## Inputs

1. "Add a capability that lets a signed-in person list their last 20 capability runs, with a count of failures per capability. Plan it."
2. "The sandbox tests time out on CI. Raise every sandbox test timeout to 60 seconds. Plan it."
3. "Add a nightly report of how many runs each capability had, shown on a new web page. Plan it."

## Results

Playbook names resolve as `skills/<name>/SKILL.md`. Each router run also opens `skills/rat-stack-mode/SKILL.md`. Leaf names below resolve as `skills/rat-stack-mode/principles/<name>.md`. Baseline runs open no principle leaves; that directory does not exist on baseline.

| Task | Baseline playbooks opened | Scored router playbooks opened | Leaves opened | Tool calls, baseline → router |
| --- | --- | --- | --- | --- |
| Recent history | `add-a-capability` | `add-a-capability`, `add-a-store`, `learn-alchemy`, `learn-rat-stack`, `uncomplect` | 24 | 33 → 83 |
| Sandbox timeout | None from this repo | `gardener` | 5 | 20 → 30 |
| Nightly report | `add-a-capability`, `add-a-lifecycle-machine`, `learn-alchemy`, `learn-rat-stack` | `add-a-capability`, `add-a-lifecycle-machine`, `add-a-store`, `learn-alchemy`, `learn-rat-stack`, `uncomplect` | 26 | 44 → 79 |

Score 1 means the plan explicitly includes the decision. Score 0 means it omits that decision. These scores assess plans, not executed behavior.

| Decision | Baseline | First repaired-pointer router | Revised router |
| --- | --- | --- | --- |
| History: reuse the authoritative log and bound results to 20 | 1 | 1 | Not rerun; unchanged requirement |
| History: inspect query plans and distinguish replay-unsafe recording | 0 | 1 | Not rerun; retained |
| Timeout: establish the measured baseline before budget edits | 0 | 0 | 1 |
| Timeout: preserve sandbox enforcement deadlines | 1 | 1 | 1 |
| Report: read a stored summary, not raw history per page | 1 | 1 | 1 |
| Report: bound recovery reads and inspect aggregation access paths | 0 | 1 | 1 |
| Report: preserve execution availability when capture fails | 1 | 0 | 1 |

### Recent history

Both plans reuse `RunLog` and count failures within the returned window. The router does not change those choices.

The router plan adds the named index, query-plan inspection, and the fresh-ID recording limitation. It also avoids claiming complete crash coverage from the current outcome schema. Both plans discover that production recording and sign-in are not composed yet.

Opened leaves:

`ask-one-material-question`, `bound-every-read`, `check-the-actual-artifact`, `gates-guard-invariants`, `judge-through-the-person`, `keep-boundary-words-honest`, `keep-execution-receipts`, `keep-the-stack-floor`, `keep-unknown-distinct`, `look-it-up-first`, `make-operations-idempotent`, `measure-real-limits`, `name-the-system-of-record`, `no-dual-writes`, `one-contract-many-projections`, `one-writer-per-partition`, `prove-the-recipient-path`, `scope-private-data`, `store-source-facts`, `subtract-before-you-add`, `tests-detect-broken-behavior`, `use-plain-language`, `use-real-provider-guarantees`, `validate-before-durable-write`.

### Sandbox timeout

Baseline proposes budget edits first. It calls them mitigation and preserves enforcement deadlines. The first router plan does the same. Labeling an unmeasured value does not put measurement before the change.

The revised router explicitly requires a baseline before edits, even when the prompt supplies the constant. Its fresh plan starts with failed-test names, elapsed times, and timeout categories before proposing outer-budget edits. It still treats 60 seconds as unproven and preserves runtime, readiness, and cleanup limits. No probe measures current CI; planning-only scope forbids that execution.

Opened leaves:

`check-the-actual-artifact`, `find-the-cause-first`, `measure-real-limits`, `optimise-the-whole-loop`, `tests-detect-broken-behavior`.

### Nightly report

Baseline already chooses a stored report and preserves execution results when capture fails. The first router plan forces `RunLog` expansion and gates capability admission on successful start recording. That adds an availability dependency the task does not require. It is worse than baseline.

The repair makes store reuse conditional on matching facts and operation guarantees. It also requires an explicit product invariant before reporting can gate unrelated execution.

The fresh plan keeps anonymous receipts distinct from person-scoped completed runs and preserves admission and results on capture failure. It gives the report a keyed read, bounded catch-up, query-plan evidence, and explicit recorded-count coverage. Both variants choose a read model; the gain is safer ownership and bounded recovery, not discovering read models.

Opened leaves:

`ask-one-material-question`, `bound-every-read`, `check-the-actual-artifact`, `design-serves-function`, `gates-guard-invariants`, `judge-through-the-person`, `keep-boundary-words-honest`, `keep-execution-receipts`, `keep-the-stack-floor`, `keep-unknown-distinct`, `look-it-up-first`, `make-operations-idempotent`, `make-review-views-complete`, `measure-real-limits`, `name-the-system-of-record`, `no-dual-writes`, `one-contract-many-projections`, `one-writer-per-partition`, `prove-the-recipient-path`, `scope-private-data`, `store-source-facts`, `subtract-before-you-add`, `tests-detect-broken-behavior`, `use-plain-language`, `use-real-provider-guarantees`, `validate-before-durable-write`.

## Candidate receipts

Fingerprint the sorted candidate files as `path sha256(file-bytes)`, with one trailing newline per entry. Hash that UTF-8 sequence with SHA-256. Include AGENTS.md, the content generator, both new SKILL.md files, the license, and every principle leaf. Exclude this report to avoid a self-referential hash.

| Candidate | SHA-256 | Scored evidence |
| --- | --- | --- |
| Repaired pointers | `fd82c16dbfff3c493da692d7c39ae2b69b225354b3885b27a058e6f191046a7e` | History; initial timeout and report plans |
| Store-fit and availability repair | `519808f9f3a7e3fbaa7eae406e175eb8ba9bcb897607edf021d3c2fe0a8b853b` | Fresh nightly-report plan |
| Measurement-order repair | `c8ee5471a25e2f03ed994c41723b062d76cb8c020e57ca07cb02699b91f0f22e` | Fresh timeout plan |
| Final artifact | `8fd14ff64726eff3e00203e7cfefd4da163c2a59f22e2cd805d468c34b1fcd31` | Citation wording only; no further planning run |

Tool-result body hashes match the recorded candidate for every opened new skill and leaf in the scored runs. History is not rerun after the focused report and limit repairs. The candidate table preserves that distinction.

A citation audit also corrects PR #8's budget attribution and the feedback-loop leaf's Held-by configuration. The final artifact labels its measured tally as 58/58 without claiming a unit not stated by that source.

## Limits and judgment

- This is one planning sample per scored variant, not an implementation or deployment test.
- Both variants inherit machine-level guidance. Public lists exclude non-repository skill paths.
- Baseline has no installed dependencies; the working branch does. Installed-source findings can reflect that difference.
- Task order and candidate revisions are not randomized. Do not infer general causal effectiveness from this small sample.
- Tool calls rise from 97 to 192 across the three scored pairs. More reading is a cost, not proof of quality.
- Multiple-playbook routing works in the store-backed cases. Plans summarize playbook sequences rather than always copying every step verbatim.
- The timeout repair changes plan order. The report repair removes a harmful choice caused by overly broad guidance.
- Retain the router for these decision checks. Do not claim that this eval proves better code or faster work.
- Leaves remain checkout-only code-path pointers. The site does not publish them or make those pointers clickable.
