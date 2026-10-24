---
name: onboard-a-list
description: Analyze or migrate an email list. Measure sanitation rules, preserve stops, choose a cohort, and verify an authorized import or sending cutover.
plain: "Capture source facts, measure overlapping cuts, preserve stops, and verify the authorized outcome."
diagram: |-
  capture facts
        |
  measure cuts
        |
  choose cohort
        |
  approved writes
        |
  stops -> profiles
        |
  switch -> readback
---

# Onboard a list

Produce a census, a versioned selection policy, and a private cohort manifest. Import or switch sending only within the task's authority.

For routine broadcasts to an onboarded audience, use the project's sending procedure.

This procedure defines a migration job. It does not install an importer.

## Start with the source and authority

Identify the source account, destination tenant, email topics, available credentials, and approved operations. Reuse an approved cohort choice. Ask only for missing decisions that affect the result or authorize a new live action.

Name the facts and their writer:

- The source owns contact, consent, stop, activity, and automation facts until cutover.
- `ReadListSnapshot` captures those facts through a job-shaped [port](/lore/hexagonal-architecture). Keep provider vocabulary inside [adapters](/lore/hexagonal-architecture).
- The pure planner derives counts, intersections, and cohort selection.
- Destination contact and stop services own imported state. Profile imports cannot lift stops.
- Policy and capture receipts identify the inputs. A private manifest records exact tenant-scoped recipients and matched rule ids.

Read [contracts and policy](https://github.com/joelhooks/rat-stack/blob/main/skills/onboard-a-list/references/contracts.md) when defining an [adapter](/lore/hexagonal-architecture) or import policy. Read [the count-only example](https://github.com/joelhooks/rat-stack/blob/main/skills/onboard-a-list/references/worked-example.md) when explaining overlaps.

## 1. Capture a read-only inventory

Inventory broadcasts, journeys, welcome flows, transactional/API callers, scheduled jobs, and historical link services. Measure actual sends over an explicit window. Enabled does not mean sending. A welcome flow may be the only active sender.

Capture every page of contacts, addresses, topic/channel/global preferences, and permanent stops. Include stopped addresses without profiles.

Reconcile unique keys, terminal cursors, export row totals, and available before/after counts. Record observation times and concurrent-change gaps. Claim a transactional snapshot only when the source provides one.

Keep recipient rows, signed URLs, credentials, and source cursors private. Reports contain aggregates and safe source receipts. Limit read credentials to the source account.

Use read-only export/search jobs only when the task authorizes them. They must not alter customer state.

## 2. Establish the stop floor

Separate authoritative unsubscribes, complaints, hard-bounce stops, and provider denials from delivery events and heuristics. A bounced delivery alone does not prove a permanent hard-bounce stop.

Resolve identity conservatively. Preserve stops without profiles and their original reasons. Never rewrite typo addresses or collapse plus tags. Use only documented identity normalization. Report ambiguity.

Before enabling destination sends, durably import and read back the complete stop floor. Profile imports and consent defaults must not lift it. Keep later source and legacy-link stops flowing until continuity is proven.

## 3. Measure each proposed rule

Decode policy data with [Effect](/lore/effect-basics) [Schema](/lore/schemas-define-the-boundary). [Pin](/skills/gardener) external lists by source, revision/date, and digest. Store thresholds, domain/local-part sets, windows, and actions in that policy.

Measure each rule against each original pool. Report independent matches, pairwise overlaps, exclusive matches, the union, and an ordered waterfall. Show newly removed and remaining counts. Never add independent counts.

Keep observations separate from person-level conclusions:

- Disposable-list membership supports a cohort-quarantine proposal. It does not identify a bot person.
- Query DNS once per distinct domain during research. Record resolver view, observation time, and failures. Empty MX can permit [address-record fallback](https://www.rfc-editor.org/rfc/rfc5321#section-5.1). [Explicit null MX](https://www.rfc-editor.org/rfc/rfc7505) is different. Revalidate time-sensitive evidence before applying a cut.
- Role mailboxes, typo-like domains, digit runs, entropy, and creation bursts can match real readers. Keep them review-only unless the owner chooses a bounded cohort restriction.
- Search available positive login, purchase, and learning evidence before counting an activity-absence proxy. Missing history remains unknown.
- Distinguish human metrics, raw metrics, and first versus repeat timestamps. Security scans and privacy prefetch are not human engagement. Fast events do not prove bot people.

Do not invent missing evidence or measured precision. Label any analyst precision guess unvalidated. Keep it separate from measurements.

## 4. Choose and pin the cohort

Present alternatives and one recommendation. Explain exact counts, bounds, gaps, and tradeoffs.

When engagement is required, use positive human evidence. Explain which readers first-event-only history can miss. Do not substitute raw opens when human evidence is unavailable.

Let the owner choose unresolved engagement windows and optional restrictions. Pin source receipts, base manifest, policy digest, cohort digest, and destination tenant.

Dry-run and apply use the same pure planner and policy bytes. Changed policy or widened eligibility needs a new selection. Newly discovered stops always narrow it.

Read [verification properties](https://github.com/joelhooks/rat-stack/blob/main/skills/onboard-a-list/references/verification.md) before accepting the planner. Cover the deduplicated waterfall and the weak-signal boundary.

## 5. Dry-run and prepare the destination

Reuse owned destination contracts. When building automation, expose census, planning, and import as typed capabilities. Project CLI, HTTP, and agent tools from those contracts.

Dry-run exact identities, stop matches, ambiguous records, counts, and value-level readback. Use tenant-scoped [idempotency keys](/lore/http-responses-need-validation) and durable resume checkpoints.

For an authorized import, write stops first, then profiles. Do not discard rejected stop rows or mark partial work complete.

Prepare sender ownership, authentication, content, tenant-scoped routing, consent basis, unsubscribe handling, and historical-link continuity. Verify real bindings with authorized synthetic recipients. Preserve other mail systems on shared domains.

## 6. Make the authorized switch

For a hard switch, stop every old sending path. Prove that stop before enabling destination sends. Do not invent a parallel sending period.

Capture final contact, consent, and stop deltas through a recorded boundary. Describe and close consistency gaps before claiming completion.

Keep old unsubscribe/tracking links working when needed, with old sending disabled. Persist new stops before acknowledging them. Enforce stops at final dispatch. An eventually consistent cache alone cannot protect that boundary.

Enable only the approved cohort. Reconcile accepted, completed, failed, and unknown provider outcomes. Never blindly retry an uncertain send.

On harm, stop the affected destination path. Restart the old sender only when that recovery action is authorized.

Use a persisted lifecycle: capture → measure → choose → prepare → switch → verify. Put retries, deferrals, cancellation, and resume in XState. Run work through Effect actors under the project's pins. A delay proves neither failure nor completion.

## 7. Prove and report the result

Read back stops, exact profile values, cohort counts, and both dispatch controls. Prove a stopped synthetic address cannot regain eligibility through signup or profile import. Prove historical unsubscribe links durably stop later dispatch.

Verify topic behavior and tenant isolation. Use authorized delivery receipts for real-send claims.

After cutover, measure later eligibility from destination-owned human events. State which human events are recorded. A clock window passing does not justify widening the cohort.

Report analysis-ready, import-verified, and sending-verified separately. Include input digests, exact/bounded sections, overlaps, rejected records, checkpoints, gaps, and the next authorized move.

Keep raw manifests private. Scan shareable artifacts for recipient patterns.

Register an event watch for unfinished external work. Act when its result arrives. Reconciled receipts prove analysis. A report alone does not prove an import or send completed.
