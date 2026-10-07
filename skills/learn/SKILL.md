---
name: learn
description: Present Effect, Alchemy, XState, and application-design concepts during real work when the operator enables learn mode. Use for adaptive explanations and local learning progress.
terms:
  - "learn mode"
---

# Learn during real work

Teach the technology and principles in play. Use the project as a worked example. Keep the current task moving.

## Start and stop

- Start only when the operator enables learn mode.
- Keep questions off unless the operator explicitly enables them.
- Stop tool calls and explanations when the operator turns learn mode off.
- Keep existing progress when stopping. Turning the mode off does not erase history.
- Record `dismissed` when the operator asks to stop presenting one concept.
- Do not promise a reset or signed-in sync. Those tools are not available.

## Use the local tools

Build the CLI from a checkout:

```sh
pnpm turbo run build --filter=@rat-stack/cli
```

Configure the agent's stdio MCP client to run this command from that checkout:

```sh
node apps/cli/dist/cli.js mcp
```

Add `--devtools` when checking recorded calls. The local tool descriptions say they use the local event log. Public MCP and HTTP learning tools use supplied progress and store nothing.

The default local store is `~/.rat-learn/`. `RAT_LEARN_DIRECTORY` selects another local directory. `RAT_LEARN_ORIGIN` selects the public deck origin.

## Select and present

1. Read `learnDeck` and match public terms to the ideas in the work.
2. Keep that matching step local. Select only real concept ids from the deck.
3. Call local `learnNext` when an Effect, Alchemy, or XState idea appears in the work.
4. Set `context.ids` to those concept ids and `context.at` to the current Unix time in milliseconds.
5. Set `context.asked` only when the operator asks for an explanation.
6. Supply empty version 1 progress to satisfy the shared contract. The local tools read their own log.
7. Follow the returned depth. Present one relevant concept at a time.

| Depth | Presentation |
| --- | --- |
| walkthrough | Show the card's claim and summary. Link its page. Read that page and show its relevant pinned excerpt. |
| paragraph | Give the source summary as a short paragraph. Link the page for more detail. |
| line | Give one source-grounded sentence. |
| none | Say nothing. The tool omits concepts that need no presentation. |

Use the existing page's excerpt and immutable revision. Never invent an excerpt or substitute current source for its pin. If the page has no excerpt, use a pinned code reference from the card. State when no suitable excerpt exists.

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

Build first, then run `node apps/cli/dist/cli.js learnNext` with `--context` and `--progress` JSON flags. Record with `learnRecord --event` and `--progress`. Use current timestamps for real learning events.

If the deck or CLI is unavailable, report that limit and continue the task. Do not claim that progress was saved. Never hand-edit the JSONL files.

## Privacy

Keep progress local. Use the public endpoints for deck and card reads. Do not send progress to public selection or recording endpoints by default.

Requests contain concept ids, timestamps, depth, familiarity, and dismissal state only. Never include code, file paths, names, repository names, or prompts. The event log is authoritative. The CLI rebuilds `cards.jsonl` and `tasks.jsonl` from it.
