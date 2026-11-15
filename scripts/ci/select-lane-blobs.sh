#!/usr/bin/env bash
set -euo pipefail

# Copies, for every browser lane, the blob report of its newest attempt.
#
# Lane artifacts are named `blob-report-<lane>-attempt-<n>` so that re-running
# jobs never replaces the evidence of an earlier attempt. The gate must still
# judge one report per lane: merging every attempt would count a re-run lane
# twice. Writes `e2e-lane-attempts.txt` and the job summary so a merged report
# always says which attempt each lane came from (feature 060).

source_root="${1:?usage: select-lane-blobs.sh <downloaded-artifacts> <destination>}"
destination="${2:?usage: select-lane-blobs.sh <downloaded-artifacts> <destination>}"
mkdir -p "${destination}"
: >e2e-lane-attempts.txt

shopt -s nullglob

# Prints "<lane> <attempt> <directory>" for every downloaded lane artifact.
list_lane_artifacts() {
    local directory name attempt lane
    for directory in "${source_root}"/blob-report-*-attempt-*; do
        name="$(basename -- "${directory}")"
        attempt="${name##*-attempt-}"
        lane="${name#blob-report-}"
        lane="${lane%-attempt-*}"
        if [[ -z "${attempt}" || "${attempt}" == *[!0-9]* ]]; then
            echo "unexpected lane artifact name: ${name}" >&2
            return 1
        fi
        printf '%s %s %s\n' "${lane}" "${attempt}" "${directory}"
    done
}

listing="$(list_lane_artifacts)"
selection="$(
    printf '%s\n' "${listing}" | sort -k1,1 -k2,2n |
        awk 'NF { newest[$1] = $0 } END { for (lane in newest) print newest[lane] }' | sort
)"

while read -r lane attempt directory; do
    [[ -n "${lane}" ]] || continue
    for report in "${directory}"/*.zip; do
        cp -- "${report}" "${destination}/"
    done
    printf '%s attempt %s\n' "${lane}" "${attempt}" | tee -a e2e-lane-attempts.txt
done <<<"${selection}"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
        echo "### Lane attempts merged by the gate"
        echo
        sed 's/^/- /' e2e-lane-attempts.txt
    } >>"${GITHUB_STEP_SUMMARY}"
fi
