## BLOCKERS

None.

## QUALITY

- `apps/web/src/client/docs/model.ts:7-19`: remote reads and searches use hand-written four-state unions. Idiomatic version: `AsyncData.Schema` or an experimental Query held in the Model.
- `apps/web/src/client/docs/queries.ts:16-25`: the client service holds caches outside the Model. Idiomatic version: an experimental Query in the Model when the document browser is retained.
- `apps/web/src/features/app.ts:24-142`: Model spreads and repeated generation guards obscure the update path. Idiomatic version: `modifyFields` and one named guard, or Query-managed remote state.
- `apps/web/src/dev/features/overlay/overlay.ts:24-102`: `open` and `pending` booleans, empty-string errors, and a nullable result represent several lifecycle states. Idiomatic version: explicit lifecycle unions and Option for absence.
- `apps/web/src/dev/client/message.ts:7-17`: input Messages use `Changed*`, and inspection results do not mirror the Command name. Idiomatic version: `Updated*`, `SucceededInspect`, and `FailedInspect`.
- `apps/web/src/features/app.ts:191`, `apps/web/src/dev/features/overlay/overlay.ts:240`: view functions combine several regions and exceed the exemplar's decomposition bar. Idiomatic version: named form, navigation, status, and panel views.
- `apps/web/src/features/app.ts:46,118`, `dev/features/overlay/overlay.ts:402`: string emptiness uses length comparisons. Idiomatic version: Effect String predicates.
- `apps/web/src/client/reader/model.ts:22-49`: Option fields lack the `maybe*` naming convention. Idiomatic version: prefix Option fields when a separate schema migration is approved.
- `apps/web/src/client/cafe/update.ts:15`, `client/reader-document.ts:6,8`, `client/reader-node.ts:96-97`: array type syntax differs from the pinned conventions. Idiomatic version: `ReadonlyArray<T>`.

## NICE-TO-HAVE

- `apps/web/src/client/reader/update.ts:40`: the update signature repeats the type supplied to `Message.match`. Remove the duplicate annotation in a convention-only pass.
- `apps/web/src/client/docs/command.ts:44`: navigation scrolls through `window.scrollTo` inside a Command. Foldkit Dom can also coordinate heading focus.

## VERDICT

NEEDS-WORK: zero BLOCKERS. The remaining QUALITY findings predate this packet and sit outside the approved document/widget migration. Routing stays unchanged; the document browser does not ship as `/search`.
