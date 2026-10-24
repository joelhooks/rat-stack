# Count-only worked example

Observation date: 2026-10-24.

These aggregates illustrate one sanitation pass. They contain no source account, recipient identities, domain inventory, or provider-specific procedure.

They are observations, not defaults or predictions for another list.

## Two original pools

- Pre-engagement pool: **79,545** people, after existing consent and permanent-stop exclusions.
- Positive first-human-open cohort: **26,129** people, using a proposed 120-day window. Cohort approval remained separate.

The second pool is a subset of the first. First-event-only history can miss someone whose first open was old but who read again recently.

The window is a cohort choice. It does not prove everyone outside it is inactive.

## Independent rules and the waterfall

Independent matches:

- **Pinned disposable-domain list**:
  - Base: 1,158.
  - Cohort: 34.
- **Observed NXDOMAIN**:
  - Base: 438.
  - Cohort: 4.
- **Explicit null MX**:
  - Base: 182.
  - Cohort: 1.

Do not add independent counts. The ordered fold removes only newly matched identities:

- **Disposable list**:
  - Newly removed from base: 1,158. Base remaining: 78,387.
  - Newly removed from cohort: 34. Cohort remaining: 26,095.
- **NXDOMAIN**:
  - Newly removed from base: 427. Base remaining: 77,960.
  - Newly removed from cohort: 3. Cohort remaining: 26,092.
- **Null MX**:
  - Newly removed from base: 176. Base remaining: 77,784.
  - Newly removed from cohort: 1. Cohort remaining: 26,091.

The union removes **1,761** base people and **38** cohort people. It leaves **77,784** and **26,091**.

The analysis also kept pairwise intersections and exact combinations. A waterfall alone cannot answer every overlap question.

An optional fast-only first-human-open screen matched 119 cohort people. It overlapped the proposed union by 12. It added **107**, not another 119.

Both proposals together would remove 145 and leave **25,984**. This is a cohort restriction proposal, not 119 confirmed bots.

## Positive evidence prevents careless inactivity cuts

A profile/email-only absence proxy matched **8,016** base people. Added paid/learning memberships and positive learning attributes preserved **2,321** of them.

The enriched proxy matched **5,695** base people. It matched zero members of the human-open cohort.

Complete login and transaction histories were unavailable. The exact never-active count remained **unknown**. Neither proxy justified a permanent suppression.

## Weak signals do not explain every bounce

One welcome flow recorded **492 bounces from 1,601 sends**, or **30.7%**.

Its bounced messages matched:

- Disposable-domain list: **285**, or **57.9%**.
- Profile-created hour bursts: **436**, or **88.6%**.
- Disposable, minute burst, hour burst, and enriched activity-absence proxy together: **284**.
- Digit-run or high-entropy local-part heuristics: **zero**.

The data supported investigating concentrated disposable/signup contamination. It did not support treating generated aliases as bots. It did not predict the sanitized cohort's future bounce rate.

A creation timestamp could represent a backfill. Its meaning stayed explicit.

The pre-engagement pool still contained 290 of those bounced people. The human-open cohort contained zero.

Delivery bounce events and an authoritative permanent-bounce registry are different facts.

## Observed unknowns remain visible

The domain pass covered the captured source, not just the two cohorts. It queried **23,789 distinct domains** once each:

- Positive MX results: 22,068.
- NXDOMAIN responses: 829.
- Empty MX answers: 659.
- Null MX results: 113.
- Resolver errors: 120.

Empty MX did not prove non-deliverability. Address-record fallback was not checked. Resolver errors remained unknown.

Positive MX did not prove a particular mailbox existed. The proposed bad-DNS cuts required fresh revalidation before application.

The source-human-open rule excluded **11,696** base people with recent raw opens but no qualifying human open. It still admitted some fast qualifying first-human opens.

Client flags and repeat-event history were missing. Exact privacy-prefetch and scanner-person counts remained unavailable.

## What the packet proved

The packet proved source coverage, count reconciliation, rule overlaps, and a reproducible selection proposal.

It did not prove:

- An import or live sender binding.
- Future deliverability or calibrated bot precision.
- Permission to send.

Those claims need their own authorized operations and receipts.
