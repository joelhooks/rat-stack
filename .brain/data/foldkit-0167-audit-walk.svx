# Audit walk

Scope: `apps/web/src`, with its tests in `apps/web/test`. Starting revision: `aa8302f`. Reference: Foldkit `foldkit@0.167.0`, revision `74071173b1253e9efeec050a31ca86df1931ce5a`.

The reader combines static document rendering with Tier 3 clipboard Commands and a Tier 4 cafe child. The retained document browser has Tier 4 routing and async reads. The dev overlay is a separate Tier 3 embedded program. Server entries, build adapters, and Cloudflare composition are boundaries, not browser TEA programs.

Reviewed against the pinned SSG, weather, routing, and UI showcase examples. The installed APIs agree with that revision. The config maps the recommended rules and their scoped overrides rather than copying their names. Version 0.15.3 has 37 recommended rules; the unchanged config enables them. No rule is disabled in this packet.

The re-audit is inline. The task requests a bounded audit, not delegation. Root no-comments, StyleX, privacy, and test-runner rules override upstream scaffold preferences. The original approved migration supplies fix authorization.

| Blind spot | Result after changes |
| --- | --- |
| off-by-one | Clean: generation advances on each request; no new counter logic. |
| skip-reset-semantics | Clean: copy reset only clears Copied; stale copy results cannot revive a completed flow. |
| state-machine-edges | Clean: each clipboard state is reachable and exits; generated history tests cover stale results. |
| derived-data-in-model | Flagged at `client/reader/model.ts:77`: static Flags are copied into the Model; deferred measurement work. |
| dead-variants-and-noop-commands | Clean: navigation acknowledgments are legitimate Command results; startup detects clipboard availability. |
| repeated-scaffolding | Flagged at `features/app.ts:103-139`: repeated generation guards and repeated update return annotations. |
| manual-update-return-unpacking | Clean: no update result destructuring in source. Reader browser init keeps the named result. |
| functions-doing-two-things | Flagged at `dev/features/overlay/overlay.ts:240`: navigation, fields, panel layout, and statuses share one view. |
| manual-cache-orchestration | Flagged at `client/docs/queries.ts:16-25`: caches live outside the Model. |
| naming-drift | Flagged at `dev/client/message.ts:7-11`: Changed input names. |
| messages-naming-the-effect | Flagged at `dev/client/message.ts:14-17`: inspection results do not mirror Inspect. |
| view-named-after-namespace | Clean: primary view exports are named view. |
| unearned-type-aliases | Clean: schema types cross module boundaries; Cafe UpdateReturn has multiple consumers. |
| effect-module-inconsistency | Clean for this packet: no native methods introduced into Effect pipes. Direct native calls are allowed by pinned conventions. |
| stuttery-modifyFields-setters | Clean: copy state and Cafe selected updates use field transformers. |
| empty-object-constructors | Clean: remaining empty objects are RPC input payloads. |
| hand-rolled-async-state | Flagged at `client/docs/model.ts:7-19`: read and search four-state unions. |
| array-type-syntax | Flagged at `client/cafe/update.ts:15`, `client/reader-document.ts:6,8`, and `client/reader-node.ts:96-97`. |
| hard-coded-route-paths | Clean: source view hrefs use printers or data; server request routing is a boundary. |
| unkeyed-list-rows | Clean: interactive directory letters, contracts, and call rows have stable identifiers. Overlay tab names are a fixed sequence. |
| data-derived-keys | Clean: keys identify source records, letters, or call sequence IDs. |
| flat-parent-message-union | Clean: reader wraps Cafe messages and folds the child through Update. |
| hand-rolled-widgets | Clean: all 15 control sites now use Button, Input, or Textarea; every raw element is inside toView and uses its supplied group. |
| a11y-gaps | Clean: input names, copy status announcements, one heading per document, focus styles, and external Rel remain. |
| aria-role-confusion | Clean: directory filters remain pressed toggle buttons. |
| missing-scene-test | Clean: reader, cafe, docs, and overlay have interactive Scene tests with assertions and Command resolution. |

Exemplar comparison: the new reader Button callback follows UI showcase's stateless render pattern. The docs-browser Model still differs from weather's AsyncData Model. That remains a QUALITY finding, not a hidden pass.

New behavioral gap: the overlay had no Scene test before the widget replacement. Added tests prove open/failure/retry/close and capability-input/JSON-textarea submission. A planted bug that forced every capability input to `search` made the submission test fail. Restoring the input mapping made both tests pass.

Existing reader error and preview-output properties move to the generated-document seam. They retain their metadata, body, status, footer, preview-header, and production-transition assertions. Finalization no longer repairs an HTML template.
