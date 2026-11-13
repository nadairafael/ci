#!/usr/bin/env bash
# Queue vs work time per runner, from the jobs of the runs created in the last <dias> days.
# Usage: scripts/fila.sh <dias> <owner/repo>...
set -euo pipefail
dias="$1"; shift
desde=$(date -u -v-"${dias}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "-${dias} days" +%Y-%m-%dT%H:%M:%SZ)
for repo in "$@"; do
  gh run list -R "$repo" --limit 200 --json databaseId,createdAt \
    -q ".[] | select(.createdAt > \"$desde\") | .databaseId" |
  while read -r id; do
    gh api "repos/$repo/actions/runs/$id/jobs" \
      -q '.jobs[] | select(.started_at != null and .runner_name != null and .runner_name != "") |
          "\(.runner_name)\t\((.started_at|fromdate) - (.created_at|fromdate))\t\(((.completed_at // .started_at)|fromdate) - (.started_at|fromdate))"'
  done
done | awk -F'\t' -v OFS='\t' '
  { if ($1 ~ /^GitHub Actions/) $1 = "hospedado-github"; n[$1]++; q[$1]+=$2; w[$1]+=$3; if ($2 > mx[$1]) mx[$1]=$2 }
  END { for (k in n) printf "%-24s jobs=%-4d fila_media=%5.1fmin fila_max=%5.1fmin trabalho_medio=%5.1fmin\n", k, n[k], q[k]/n[k]/60, mx[k]/60, w[k]/n[k]/60 }' | sort
