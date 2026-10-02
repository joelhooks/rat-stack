---
name: write-a-wiki-page
description: Write or revise public wiki pages with short prose, cited claims, meaningful visuals, and pinned code snippets.
---

# Write a wiki page

Write one useful page from checked sources. Keep claim titles and quoted voice. Do not invent facts to complete a page.

## 1. Choose the kind

| Kind | Source | Rule |
| --- | --- | --- |
| Lore | `.brain/resources/lore/<slug>.svx` | Use a claim title and `group: idea`, `concept`, `source`, or `person`. |
| System | `.brain/areas/<slug>.svx` | Use `group: system`. Include What it does, The standard, and How to check. |
| Skill | `skills/<name>/SKILL.md` | Match directory and frontmatter `name`. Give the skill a distinct triggering description. |
| Resource | `.brain/resources/` | Keep reference material here. Check publication wiring. Use clean `/resources/<slug>` links, not `.svx` URLs. |
| Glossary | A lore page's frontmatter `terms` | Add supported terms. The generator builds `/glossary`. |

Use `title`, `description`, `group`, `terms`, and `sources` for lore and systems. Copy a nearby page's field shape.

Use one H1 per rendered view. Lore and system titles come from frontmatter; do not repeat them as body H1s. Skills include their own H1.

Lore and system directories are discovered without per-page registration. Skills are discovered too, but need a group in `skillGroups` in `apps/mischief/scripts/generate-content.ts`.

## 2. Write short prose

Follow the Wiki writing section in `AGENTS.md`. Aim about 80% toward Simplified Technical English, not robotic prose.

- Aim for 20 words per sentence. Keep descriptive sentences within 25 words.
- Put one idea in each sentence.
- Use active voice and present tense where the facts allow it.
- Use the same glossary term for the same thing.
- Prefer lists to dense paragraphs.
- Give one instruction per step.
- Remove idioms and filler.
- Keep historical observations dated. Do not turn observations into guarantees.

Before:

> The schema is used by the handler in order to ensure that input is decoded before dispatch can take place.

After:

> The handler decodes input with the schema before dispatch.

Generation warns on sentences above 25 words and paragraphs above four sentences in lore and systems. Warnings show `file:line`, the count, and the limit. The generator prints a total too.

The check reads parsed prose, including list paragraphs. It skips code, tables, blockquotes, and frontmatter. Warnings never fail the build. Fix new warnings or explain why they remain.

## 3. Use a visual when it explains something

| Need               | Use                        |
| ------------------ | -------------------------- |
| Flow or topology   | Fenced box-drawing diagram |
| Trade-off or state | Table                      |
| Logic              | Pseudocode                 |
| File placement     | Shallow tree               |

Keep diagrams below 80 columns. Use one visual per point, with one or two nearby sentences and a What to notice line. Remove decorative visuals.

## 4. Quote code from its source

Follow [Code snippets quote a pinned source](/lore/code-snippets). Author Markdown fences, not `<Code>` elements.

Metadata accepts:

- An optional language.
- Whitespace-separated `key=value` or `key="quoted value"` pairs.
- JSON string escaping inside double quotes.
- At most one highlight set, such as `{3,5-7}`.
- Only `repo`, `path`, `at`, `lines`, and `title` keys.

A small authored example may have a body:

````markdown
```ts {2} title="answer.ts"
const answer = 42;
export { answer };
```
````

**What to notice:** The highlight uses the inline example's line numbers.

A source reference has an empty body. This fence quotes the shipped SHA check:

```ts repo=rat-stack path=packages/code-snippets/src/scanner.ts at=a646f7ffd00273d85fbe1d905d9cdb194fdc0f60 lines=180-190 {189} title="The pin is forty lowercase hexadecimal characters"

```

**What to notice:** `at` names the immutable revision. `{189}` uses the original file's line number, not excerpt numbering.

For a reference:

1. Choose a registered repository id. The default is `rat-stack`.
2. Choose a repository-relative path without traversal, empty segments, dots, or colons.
3. Set `at` to a full 40-character lowercase commit SHA.
4. Set `lines` to positive, ordered, non-overlapping inclusive ranges.
5. Keep highlights inside the selected ranges.
6. Remove all body text.

Configured fences show at most 25 source lines. This includes inline fences with metadata. Collapsed gaps do not count. Ordinary fences without metadata are not subject to this cap.

Explicit language wins. Otherwise, a referenced extension selects it. An unmapped extension or unlabelled inline fence defaults to Markdown.

`svx` maps to Markdown; `txt` maps to text. `javascript` is accepted explicitly. Unknown explicit languages fail; use `text` for uncoloured code.

Drift warnings compare selected pinned lines with HEAD. They do not replace the pin or fail the build. Review changes before updating a SHA.

Generation reads local Git objects offline. A shallow clone must contain each pin. Run `pnpm sources:fetch` as an explicit bootstrap when objects are missing. Template children need this once after repository creation.

### Repair errors

Diagnostics print source path, line, tag, repository, file, SHA, ranges, and repair text. This is a real exact-message test example:

```text
page.svx:7 [CodeUnknownKey] rat-stack:<inline>@<inline> lines=all; Unknown key bogus; use repo, path, at, lines or title.
```

**What to notice:** Fix the fence at the first path and line. The remaining context describes the requested source.

These messages come from `packages/code-snippets/test/pipeline.test.ts` and `git.test.ts`. Example numbers describe their fixtures, not your page.

| Tag | Real repair message | Meaning and fix |
| --- | --- | --- |
| `CodeInvalidProps` | "Add path for a pinned reference, or remove repo/at/lines." | Complete the partial reference or use an inline example. |
| `CodeUnknownKey` | "Unknown key bogus; use repo, path, at, lines or title." | Remove the unsupported key. |
| `CodeDuplicateKey` | "Remove duplicate title." | Keep one value per key and one highlight set. |
| `CodeMalformedMeta` | "Close the highlight set with }." | Repair syntax. Quoted values must close too. |
| `CodeBodyWithReference` | "Remove the fence body; path references read their content from Git." | Remove copied text. |
| `CodeUnknownRepo` | "Use an id from the configured repository registry." | Choose a registered id. |
| `CodeRepositoryConfigInvalid` | "[CodeRepositoryConfigInvalid] Configure repositories as {id, adapter, location, linkTemplate?}." | Repair the registry entry. |
| `CodeMissingCommit` | "Commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb isn't in rat-stack's local objects. Run pnpm sources:fetch (template children: once, after creating the repo)." | Check the SHA, then fetch missing history. |
| `CodeMissingPath` | "File is not a blob at this commit; correct path or at." | Check the file at that revision. |
| `CodeSourceUnavailable` | "Git objects are unavailable; run pnpm sources:fetch or use a full clone containing the pinned history." | Restore access to the objects. |
| `CodeInvalidRanges` | "Order lines without overlaps, such as 3,5-7." | Sort ranges and remove overlap. |
| `CodeRangeOutOfBounds` | "File has 48 lines; range 40-62 ends past it. Choose lines within the file." | Select lines within this revision. |
| `CodeHighlightOutsideRanges` | "Highlighted line 5 is not shown; highlight only visible lines." | Select that line or remove its highlight. |
| `CodeLineCapExceeded` | "26 visible lines exceeds the 25-line cap; choose a shorter excerpt." | Reduce visible lines. |
| `UnknownLanguage` | "Unknown language nonexistent; use an active-engine language or explicit text." | Correct the language or choose `text`. |
| `CodeHighlightFailed` | "Highlighter could not tokenize this file; check the language and source encoding." | Check the file and engine adapter. |
| `SourceFetchUnknownRemote` | "Configure remote for this repository before running pnpm sources:fetch." | Configure the bootstrap remote. |
| `SourceFetchMissingCommit` | "The configured remote has no requested SHA; correct at or remote." | Check the revision and remote. |
| `SourceFetchOffline` | "Fetch failed; check the configured remote, authentication and connectivity, then retry pnpm sources:fetch." | Repair connectivity or credentials before retrying. |

`CodeInvalidProps` also reports "Pin at to a full 40-character lowercase commit SHA." Use a SHA, not a branch or tag.

`CodeBuildFailed` collects formatted failures. Its message joins them with newlines; it adds no separate repair sentence. Fix every reported fence before emission.

Check the exact-message tests when diagnostics change. Do not present a paraphrase as an exact quote.

## 5. Link claims and cite evidence

- Add only glossary terms the page supports.
- Use explicit links for claims and next actions.
- Use `<Ref page="/lore/source-page" id="claim"/>` for a checked block reference. The target needs that block id.
- Review backlinks for context. Unlinked mentions suggest connections; they are not citations.
- Add bibliography entries for factual sources.

Each entry has `url`, `title`, `publisher`, `note`, and `accessed`. The note says what the source supports. Both views show the bibliography.

Cite exact revisions for code. Keep sourced content within its evidence. Mark missing evidence rather than adding plausible claims.

## 6. Check components and disclosure

Use `apps/mischief/scripts/component-registry.ts`. Every component needs human and agent renderers. Read the agent view; do not assume a visual carries its meaning there.

Code renderers share a CodeSnippet model. Git and Shiki stay build-only. Page content ships as static assets, not a new Worker route handler.

Hot pink is the only accent. Use it for at most one thing per screen, plus focus. Links, headings, tables, and tier cells never use pink.

Use plain class and id names. Avoid ad-like names such as `ad-banner`, `advertisement`, `sponsored`, or `promo-banner`.

Never name the email delivery partner or list vendor in public prose. Describe the job generically. Keep private paths, host names, credentials, and customer data out of pages and examples.

## 7. Finish

1. Run `pnpm install --frozen-lockfile` before gates after any dependency change.
2. Run `pnpm --filter @rat-stack/mischief generate`.
3. Read all prose and source-drift warnings.
4. Run `pnpm turbo run check test build`.
5. Read the generated HTML view.
6. Read the generated Markdown view.
7. Verify one H1 per view.
8. Compare each pinned excerpt with its Git object.
9. Check glossary links, block references, citations, and the bibliography.
10. Record checks and any explained warnings before committing.

Fix failures without weakening the fence. A successful build does not prove a deployment is live.
