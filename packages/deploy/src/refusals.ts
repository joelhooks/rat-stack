import { Schema } from "effect";

export const RefusalReasonSchema = Schema.Literals([
  "alchemy-plan-refused",
  "build-and-profile-not-pinned",
  "built-content-manifest-unavailable-run-full-build",
  "checkout-has-uncommitted-changes",
  "checkout-head-does-not-match-expected-sha",
  "checkout-state-unreadable",
  "content-version-not-pinned",
  "content-version-retry-input-invalid",
  "credential-preflight-did-not-complete",
  "environment-must-not-override-profile",
  "explicit-resource-action-approval-required",
  "inside-quiet-window",
  "invalid-deploy-input",
  "invalid-or-duplicate-plan-row",
  "live-version-readback-refused",
  "missing-required-production-inputs",
  "no-approved-plan",
  "no-required-production-inputs-declared",
  "owner-sign-off-required",
  "plan-not-approved",
  "previous-live-version-not-single-deployment",
  "previous-live-version-readback-invalid",
  "previous-live-version-readback-refused",
  "previous-version-readback-invalid",
  "previous-version-readback-refused",
  "profile-credential-unavailable",
  "profile-does-not-match-deploy-input",
  "profile-input-invalid",
  "profile-input-mismatch",
  "profile-not-pinned",
  "quiet-window-config-invalid",
  "receipt-encoding-refused",
  "receipt-write-refused",
  "recovery-receipt-profile-or-targets-invalid",
  "recovery-receipt-too-large",
  "recovery-receipt-unavailable-or-invalid",
  "redirect-phase-ruleset-list-refused",
  "replacement-removal-policy-invalid",
  "required-production-inputs-invalid",
  "state-store-mutation-refused",
  "verdict-encoding-refused",
  "version-readback-refused",
  "worker-deployment-read-refused",
  "worker-readback-name-duplicate",
  "worker-readback-name-invalid",
  "worker-rollback-refused",
  "worker-scripts-list-refused",
  "worker-version-deadline-invalid",
  "zone-read-refused",
]);

export type RefusalReason = typeof RefusalReasonSchema.Type;

export interface RefusalGuide {
  readonly fix: string;
  readonly why: string;
}

const cloudflareRead =
  "the profile's Cloudflare token can read that API, then rerun `pnpm deploy:plan --profile <profile>`.";

const guides: Record<RefusalReason, RefusalGuide> = {
  "alchemy-plan-refused": {
    fix: "rerun `pnpm deploy:plan --profile <profile>` and read the Alchemy error above the verdict.",
    why: "Alchemy could not produce a plan, so nothing can be classified or applied.",
  },
  "build-and-profile-not-pinned": {
    fix: "run `pnpm deploy:prod --profile <profile> --yes`, which builds, preflights, and plans in one run.",
    why: "Apply runs only against the build and profile that preflight pinned in the same run.",
  },
  "built-content-manifest-unavailable-run-full-build": {
    fix: "run `pnpm turbo run build --concurrency=1`, then rerun the deploy command.",
    why: "Preflight pins the content generation from the built manifest, and there is none.",
  },
  "checkout-has-uncommitted-changes": {
    fix: "commit or stash every change and untracked file, then rerun with `--expectSha <full sha>`.",
    why: "A dirty tree ships code that no commit records.",
  },
  "checkout-head-does-not-match-expected-sha": {
    fix: "check out the commit you meant to ship, or pass its full sha as `--expectSha`.",
    why: "The driver ships only the commit you named.",
  },
  "checkout-state-unreadable": {
    fix: "run `git status --porcelain` in the checkout and fix whatever stops it, then rerun.",
    why: "The driver cannot prove which commit it would ship.",
  },
  "content-version-not-pinned": {
    fix: "run `pnpm deploy:prod --profile <profile> --yes` from the start, so apply records the generation.",
    why: "The checks compare live content with the generation the apply receipt pinned, and it has none.",
  },
  "content-version-retry-input-invalid": {
    fix: "set `DEPLOY_CONTENT_VERSION_DEADLINE_MS` to an integer from 0 through 600000, or unset it.",
    why: "The content-version checks need a bounded retry deadline.",
  },
  "credential-preflight-did-not-complete": {
    fix: "run `pnpm alchemy profile show` to confirm the profile and its Cloudflare account, then rerun `pnpm deploy:plan --profile <profile>`.",
    why: "Preflight could not load the profile's credential and check its permissions.",
  },
  "environment-must-not-override-profile": {
    fix: "unset the listed variable from the environment and `.env.production.local`; provider credentials come only from `--profile`.",
    why: "An environment credential would deploy as someone other than the named profile.",
  },
  "explicit-resource-action-approval-required": {
    fix: 'review each listed resource, then pass `--allow \'[{"resource":"<fqn>","action":"<action>"}]\'` for each one you approve.',
    why: "Only updates and no-ops pass by default.",
  },
  "inside-quiet-window": {
    fix: "wait until the window ends, or raise `DEPLOY_QUIET_WINDOW_MAX_WAIT_MS` (at most one hour) so the driver waits for it.",
    why: "Another deploy may be using the account during a quiet window.",
  },
  "invalid-deploy-input": {
    fix: "correct the listed keys in `.env.production.local` to match `.env.schema`, then run `APP_ENV=production pnpm exec varlock load --agent`.",
    why: "A malformed production input would deploy a broken Worker.",
  },
  "invalid-or-duplicate-plan-row": {
    fix: "rerun `pnpm deploy:plan --profile <profile>`; if it repeats, report the plan rows in the verdict as a driver bug.",
    why: "The classifier cannot approve a plan it cannot read.",
  },
  "live-version-readback-refused": {
    fix: "confirm the profile's token can read Worker deployments, then rerun `pnpm deploy:prod --profile <profile> --yes`.",
    why: "The driver cannot prove the new Worker version went live.",
  },
  "missing-required-production-inputs": {
    fix: "set each listed key in `.env.production.local`, then run `APP_ENV=production pnpm exec varlock load --agent`.",
    why: "A Worker missing required inputs fails in production.",
  },
  "no-approved-plan": {
    fix: "run `pnpm deploy:prod --profile <profile> --yes`, which plans and applies in one run.",
    why: "Apply runs only the plan classified earlier in the same run.",
  },
  "no-required-production-inputs-declared": {
    fix: "declare the Worker's required keys with `@required` in `.env.schema`, then rerun.",
    why: "Without declared inputs the driver cannot prove production is configured.",
  },
  "owner-sign-off-required": {
    fix: "get owner sign-off for the listed deletions or replacements, then pass `--ownerApproved` with the exact `--allow` entries.",
    why: "Deleting, replacing, orphaning, or unbinding a resource can lose data.",
  },
  "plan-not-approved": {
    fix: "read the verdict's `resources`, then rerun with the matching `--allow` entries or `--ownerApproved`.",
    why: "The plan holds actions the allow-list does not cover.",
  },
  "previous-live-version-not-single-deployment": {
    fix: "finish or roll back the split deployment in Cloudflare so one version serves 100 percent, then rerun `pnpm deploy:prod --profile <profile> --yes`.",
    why: "Rollback needs one prior version to restore, and traffic is split.",
  },
  "previous-live-version-readback-invalid": {
    fix: "rerun `pnpm deploy:prod --profile <profile> --yes`; if it repeats, report the Cloudflare response in the verdict.",
    why: "Cloudflare returned a deployment list the driver cannot read, so there is no rollback point.",
  },
  "previous-live-version-readback-refused": {
    fix: `confirm ${cloudflareRead}`,
    why: "Without the live version there is no rollback point.",
  },
  "previous-version-readback-invalid": {
    fix: "rerun `pnpm deploy:prod --profile <profile> --yes`; if it repeats, report the Cloudflare response in the verdict.",
    why: "Cloudflare returned a version list the driver cannot read, so there is no rollback point.",
  },
  "previous-version-readback-refused": {
    fix: `confirm ${cloudflareRead}`,
    why: "Without the prior version there is no rollback point.",
  },
  "profile-credential-unavailable": {
    fix: "refresh the profile with `pnpm alchemy profile refresh`, check it with `pnpm alchemy profile show`, then rerun.",
    why: "Every provider call runs on the named profile's credential.",
  },
  "profile-does-not-match-deploy-input": {
    fix: "set `ALCHEMY_PROFILE` in `.env.production.local` to the profile you pass with `--profile`.",
    why: "The deploy must run as exactly one named profile.",
  },
  "profile-input-invalid": {
    fix: "pass an existing profile name with `--profile <profile>`, and check it with `pnpm alchemy profile list`.",
    why: "The driver cannot load an unnamed or malformed profile.",
  },
  "profile-input-mismatch": {
    fix: "pass the same profile with `--profile` that the recovery receipt or `ALCHEMY_PROFILE` names.",
    why: "Recovery must run as the profile that deployed.",
  },
  "profile-not-pinned": {
    fix: "run `pnpm deploy:prod --profile <profile> --yes` from the start, so preflight pins the profile.",
    why: "The checks run on the profile preflight pinned, and there is none.",
  },
  "quiet-window-config-invalid": {
    fix: 'set `DEPLOY_QUIET_WINDOWS` to a JSON list such as `[{"start":"14:00","end":"15:30"}]`, both times in one form, or leave it empty.',
    why: "The driver cannot tell whether it is inside a quiet window.",
  },
  "receipt-encoding-refused": {
    fix: "rerun the deploy; if it repeats, report the verdict, because the receipt no longer matches `ApplyReceiptSchema`.",
    why: "An unencodable receipt cannot be saved as recovery evidence.",
  },
  "receipt-write-refused": {
    fix: "make `.rat/deploy/<profile>/` writable and check free disk space, then rerun.",
    why: "The driver saves recovery evidence before it changes anything.",
  },
  "recovery-receipt-profile-or-targets-invalid": {
    fix: "pass the receipt that matches `--profile`, for example `--receipt .rat/deploy/<profile>/last-apply.json`.",
    why: "Rollback restores only what the selected profile deployed.",
  },
  "recovery-receipt-too-large": {
    fix: "pass the apply receipt the driver wrote, `--receipt .rat/deploy/<profile>/last-apply.json`, not another file.",
    why: "An oversized receipt is not one the driver wrote.",
  },
  "recovery-receipt-unavailable-or-invalid": {
    fix: "pass an apply receipt the driver wrote with `--receipt .rat/deploy/<profile>/last-apply.json`.",
    why: "Rollback needs the prior versions that receipt records.",
  },
  "redirect-phase-ruleset-list-refused": {
    fix: `confirm ${cloudflareRead}`,
    why: "The plan cannot check redirect rules it cannot list.",
  },
  "replacement-removal-policy-invalid": {
    fix: "give the replaced resource a `RemovalPolicy` of `retain` or `destroy` in `apps/infra`, then rerun `pnpm deploy:plan --profile <profile>`.",
    why: "Apply must know whether a replacement keeps or destroys the old resource.",
  },
  "required-production-inputs-invalid": {
    fix: "fix the required keys in `.env.schema` and `.env.production.local`, then run `APP_ENV=production pnpm exec varlock load --agent`.",
    why: "The driver could not read the declared production inputs.",
  },
  "state-store-mutation-refused": {
    fix: "bootstrap or upgrade the state store separately with authorization, using `pnpm alchemy state bootstrap`, then rerun the plan.",
    why: "Planning never provisions or upgrades the Alchemy state store.",
  },
  "verdict-encoding-refused": {
    fix: "rerun the deploy; if it repeats, report the stdout line, because the verdict no longer matches `DeployVerdictSchema`.",
    why: "An unencodable verdict cannot be saved for review.",
  },
  "version-readback-refused": {
    fix: `confirm ${cloudflareRead}`,
    why: "The driver cannot prove the uploaded Worker version.",
  },
  "worker-deployment-read-refused": {
    fix: `confirm ${cloudflareRead}`,
    why: "Rollback needs the Worker's deployment history.",
  },
  "worker-readback-name-duplicate": {
    fix: "give each Worker in `apps/infra/alchemy.run.ts` a unique physical name, then rerun.",
    why: "Version readback maps each Worker name to one resource.",
  },
  "worker-readback-name-invalid": {
    fix: "rerun `pnpm deploy:plan --profile <profile>`; if it repeats, report the Worker resources in the verdict.",
    why: "The driver cannot read back a Worker whose name it cannot resolve.",
  },
  "worker-rollback-refused": {
    fix: "confirm the profile's token can edit Workers, then rerun `pnpm deploy:rollback --profile <profile> --yes`.",
    why: "Cloudflare refused to restore the prior Worker version.",
  },
  "worker-scripts-list-refused": {
    fix: `confirm ${cloudflareRead}`,
    why: "The plan cannot compare Workers it cannot list.",
  },
  "worker-version-deadline-invalid": {
    fix: "set `DEPLOY_WORKER_VERSION_DEADLINE_MS` to an integer from 0 through 600000, or unset it.",
    why: "Version readback needs a bounded settling budget.",
  },
  "zone-read-refused": {
    fix: `confirm ${cloudflareRead}`,
    why: "The plan cannot check routes on a zone it cannot read.",
  },
};

export const refusalGuide = (reason: RefusalReason): RefusalGuide =>
  guides[reason];

export const refusalMessage = (reason: RefusalReason, subject: string) =>
  `${subject} refused: ${reason}. ${guides[reason].why} Fix: ${guides[reason].fix}`;

const isRefusalReason = Schema.is(RefusalReasonSchema);

export const refusalFix = (reason: string | undefined) =>
  reason !== undefined && isRefusalReason(reason)
    ? guides[reason].fix
    : undefined;
