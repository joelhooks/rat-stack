---
name: learn
description: Present Effect, Alchemy, XState, and application-design concepts during real work when the operator enables learn mode. Use for adaptive explanations and local learning progress.
plain: "When learn mode is on, the agent offers one relevant concept at a time and records progress in a local log."
diagram: |-
  work mentions an idea
    │ match deck terms
    ▼
  learnNext
    │ unmet prerequisite
    │ first
    ▼
  one concept, at its depth
    │
  record what happened
terms:
  - "learn mode"
---

# Learn during real work

Teach the technology and principles in play. Use the project as a worked example. Keep the current task moving.

## Start and stop

- Start only when the operator enables learn mode.
- When the operator turns learn mode on, act at once. Read `learnPreferences`, call `learnNext` with no arguments, and present the returned concept.
- If the tools are not ready, say in one line how to ask: "Say _next concept_ any time, or keep working and I will explain ideas as they appear."
- Keep questions off unless the operator explicitly enables them.
- Stop tool calls and explanations when the operator turns learn mode off.
- Keep existing progress when stopping. Turning the mode off does not erase history.
- Record `dismissed` when the operator asks to stop presenting one concept.
- Do not promise a reset or signed-in sync. Those tools are not available.

## Use the local tools

The local tools need a rat-stack checkout whose CLI has the learn commands. Check before you build or pull:

```sh
git -C <checkout> status --porcelain
node <checkout>/apps/cli/dist/cli.js --help
```

- The help output must list `learnNext`, `learnRecord`, `learnPreferences`, and `learnSetPreferences`.
- Never pull, reset, or stash in a checkout with local changes. Clone a separate copy for the learn tools instead.
- Do not use the operator's working checkout when it is behind or dirty. A fresh clone keeps their work untouched.

Clone, then build the CLI:

```sh
git clone --depth 1 https://github.com/joelhooks/rat-stack.git rat-stack-learn
cd rat-stack-learn
pnpm install
pnpm turbo run build --filter=@rat-stack/cli
```

Configure the agent's stdio MCP client to run this command from that checkout:

```sh
node apps/cli/dist/cli.js mcp
```

Add `--devtools` when checking recorded calls. The local tool descriptions say they use the local event log. Public MCP and HTTP learning tools use supplied progress and store nothing.

The default local store is `~/.rat-learn/`. `RAT_LEARN_DIRECTORY` selects another local directory. `RAT_LEARN_ORIGIN` selects the public deck origin.

## Display preferences

`~/.rat-learn/preferences.json` holds three display choices. It stays on the machine.

| Field     | Values                | Default       |
| --------- | --------------------- | ------------- |
| `width`   | `narrow`, `wide`      | `narrow`      |
| `visual`  | `inline-text`, `rich` | `inline-text` |
| `snippet` | `full`, `terse`       | `full`        |

- Read it with `learnPreferences`. A missing file means the defaults.
- Change it with `learnSetPreferences` only when the operator asks.
- `narrow`: keep the snippet and diagram one after the other, as plain text in the reply.
- `wide`: the diagram may sit beside the snippet when the display allows it.
- `rich`: the agent's own display may render the diagram, but uses only the card's fields.
- `terse`: show the service declaration and the line that uses or provides it. `full`: show the whole snippet.

## Select and present

1. Read `learnDeck` and match public terms to the ideas in the work.
2. Keep that matching step local. Select only real concept ids from the deck.
3. Call local `learnNext` when an Effect, Alchemy, or XState idea appears in the work.
4. Set `context.ids` to those concept ids and `context.at` to the current Unix time in milliseconds.
5. You may use `context.terms` instead of ids. Pass only public terms from the deck.
6. The tool resolves a term's owner and offers an unmet prerequisite first.
7. Omit context to follow the ordered learning path. Dismissed prerequisites do not block it.
8. Set `context.asked` only when the operator asks for an explanation.
9. Omit `progress`. Omitted progress means none yet, and the local tools read their own log.
10. Follow the returned depth. Present one relevant concept at a time.

| Depth | Presentation |
| --- | --- |
| walkthrough | Show the `plain` line first, then the claim. Show the card's `snippet` as a TypeScript fence and its `diagram` as a text fence. Link the page. |
| paragraph | Give the source summary as a short paragraph. Link the page for more detail. |
| line | Give one source-grounded sentence. |
| none | Say nothing. The tool omits concepts that need no presentation. |

Use the card's `snippet` and `diagram` exactly as served. The content build compiles every snippet against the pinned versions. Never write your own snippet or diagram for a card.

A card without a snippet uses its page's pinned excerpt and immutable revision. Never substitute current source for the pin. State when that card has no suitable excerpt.

Call local `learnRecord` only after presenting. Use a `shown` event with the concept id, actual depth, current timestamp, and version 1. Selection alone does not record a presentation.

## Record what happened

- Record `used` when the operator applies the idea in their own code.
- Agent-written code alone does not establish operator use.
- Record `got-it` or `skipped` only from the operator's words.
- Do not infer understanding from silence, elapsed time, or reading a page.
- Never send the observed code or the operator's words with the event.
- If recording fails, say that progress was not confirmed. Preserve the log and follow the typed error.

## Keep it quiet

- Never quiz unless the operator opts in to questions.
- With questions enabled, ask at most one short check-in per long session.
- Use a due concept for that check-in. Accept skipping it immediately.
- Do not ask permission again after the operator has enabled the mode.
- Stop check-ins when the operator disables questions.
- Do not introduce unrelated concepts to fill a learning quota.

## Without MCP

Read the public deck through either surface:

```sh
curl -fsS https://ratstack.sh/_content/learn.json
curl -fsS https://ratstack.sh/api/learnDeck \
  -H 'content-type: application/json' --data '{}'
```

Use the CLI commands for selection and recording. They use the same local store as stdio MCP. Read [the system check](/systems/learn) for a complete round-trip.

Build first, then run `node apps/cli/dist/cli.js learnNext`. Add a `--context` JSON flag for concepts in play. Record with `learnRecord --event`. Use current timestamps for real learning events.

If the deck or CLI is unavailable, report that limit and continue the task. Do not claim that progress was saved. Never hand-edit the JSONL files.

## Privacy

Keep progress local. Preferences stay local too.

The skills installer sends anonymous usage data unless telemetry is off. Turn it off for install and removal:

```sh
DO_NOT_TRACK=1 npx skills add joelhooks/rat-stack
DO_NOT_TRACK=1 npx skills remove joelhooks/rat-stack
```

The remove command takes out every skill installed from that source. Use the public endpoints for deck and card reads. Do not send progress to public selection or recording endpoints by default.

Requests contain concept ids, timestamps, depth, familiarity, and dismissal state only. Never include code, file paths, names, repository names, or prompts. The event log is authoritative. The CLI rebuilds `cards.jsonl` and `tasks.jsonl` from it.
