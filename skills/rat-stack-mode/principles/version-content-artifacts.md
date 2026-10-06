# Version content and pin quoted code

**Applies when:** writing public content or quoting code.

Keep authored content in versioned files. Pin referenced code to an immutable revision and retain its provenance in every rendered view.

**Why:** An unpinned example silently changes underneath its explanation.

**Example:** `packages/code-snippets/src/scanner.ts` validates a full commit SHA; the pipeline resolves excerpts from local Git objects.

**Held by:** `packages/code-snippets/test/git.test.ts`; `packages/code-snippets/test/pipeline.test.ts`; `write-a-wiki-page`, step 4.

The [Effect idiom pages](/lore/structure-effect-by-domain) pin their examples and cite exact Effect source revisions.
