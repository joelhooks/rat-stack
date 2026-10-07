#!/usr/bin/env bash
set -euo pipefail

operation="${1:-}"
pr="${2:-}"
mode="${3:---plan}"
if [[ $# -gt 3 || ! "$pr" =~ ^[1-9][0-9]*$ ]]; then
  printf '%s\n' 'Pass a positive PR number, followed by --plan or --yes.' >&2
  exit 2
fi
if [[ "${ALCHEMY_PROFILE:-}" != ratstack ]]; then
  printf '%s\n' 'Set ALCHEMY_PROFILE=ratstack; preview uses profile authentication only.' >&2
  exit 2
fi
for key in CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL CLOUDFLARE_ACCOUNT_ID; do
  if [[ -n "${!key:-}" ]]; then
    printf 'Unset %s; preview uses the ratstack profile.\n' "$key" >&2
    exit 2
  fi
done

case "$mode" in
  --plan) flags=(--dry-run --detailed) ;;
  --yes) flags=(--yes) ;;
  *) printf '%s\n' 'Use --plan (default) or --yes after review.' >&2; exit 2 ;;
esac
if [[ "$operation" == deploy && "$mode" == --yes ]] &&
  [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  printf '%s\n' 'Commit the preview tree before uploading a PR preview.' >&2
  exit 2
fi
case "$operation" in
  deploy|destroy) ;;
  *) printf '%s\n' 'Unknown preview operation.' >&2; exit 2 ;;
esac

export PREVIEW_COMMIT="$(git rev-parse HEAD)"
export PREVIEW_ORIGIN="https://pr-$pr.ratstack.sh"
printf 'Preview: pr-%s; commit: %s\n' "$pr" "$PREVIEW_COMMIT"
pnpm --filter @rat-stack/infra exec -- alchemy "$operation" \
  --config alchemy.preview.ts --stage "pr-$pr" --profile ratstack \
  --env-file ../../packages/deploy/empty.env "${flags[@]}"

if [[ "$operation" == deploy && "$mode" == --yes ]]; then
  pnpm --filter @rat-stack/mischief exec -- node scripts/preview-smoke.ts \
    "https://pr-$pr.ratstack.sh" "$PREVIEW_COMMIT"
fi
