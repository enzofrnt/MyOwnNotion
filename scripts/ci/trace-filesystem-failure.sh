#!/usr/bin/env bash
# Evidence only: a green diagnostic rerun NEVER corrects the original failed gate.
# Ubuntu runner prerequisite: sudo apt-get update && sudo apt-get install -y strace
# No execve/environment or decoded read buffers. Paths/descriptor metadata only.
set -uo pipefail
umask 077

case "${1:-}" in
    unit | contract) group=$1 ;;
    *)
        echo "Expected failed original group: unit or contract" >&2
        exit 2
        ;;
esac
out="filesystem-trace-$group"
mkdir -p "$out"
status="$out/status.txt"
trace="$out/syscalls.log"
log="$out/diagnostic.log"
printf 'group=%s\npurpose=diagnostic rerun, not a fixed gate\n' "$group" >"$status"
collector=""
# Invoked indirectly by the EXIT trap (including nonzero diagnostic exits).
# shellcheck disable=SC2329
finish() {
    result=$?
    trap - EXIT
    exec 3>&- 4>&-
    if [[ -n "${trace_collector:-}" ]]; then wait "$trace_collector"; fi
    if [[ -n "$collector" ]]; then wait "$collector"; fi
    printf 'diagnostic_exit=%s\n' "$result" >>"$status"
    # Retain the last 64 MiB, including late failures; never limit the child.
    for file in "$trace" "$log"; do
        if [[ -f "$file" ]]; then
            bytes=$(wc -c <"$file")
            printf '%s_bytes=%s (cap=67108864; at cap means possibly truncated)\n' "${file##*/}" "$bytes" >>"$status"
            gzip -f "$file" || printf 'compression_failed=%s\n' "$file" >>"$status"
        fi
    done
    exit "$result"
}
trap 'finish' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
if ! command -v strace >/dev/null 2>&1; then
    echo 'capture_unavailable=strace missing; install with sudo apt-get update && sudo apt-get install -y strace' >>"$status"
    exit 127
fi
# FIFO collectors drain the entire stream and retain a bounded tail, so a late
# failure is not lost after a busy startup fills the capture budget.
# gzip runs on EXIT, including nonzero child exits and catchable termination.
mkfifo "$out/trace.pipe" "$out/log.pipe" || exit 2
exec 3<>"$out/trace.pipe" 4<>"$out/log.pipe"
{
    exec 3>&- 4>&-
    tail -c 67108864 >"$trace"
} <"$out/trace.pipe" &
trace_collector=$!
{
    exec 3>&- 4>&-
    tail -c 67108864 >"$log"
} <"$out/log.pipe" &
collector=$!
# -f follows Bun/Vitest children; one file retains PID/timestamp ordering.
# raw=read,pread64 prints pointer/count/return only, NEVER buffer contents.
strace -f -ttt -T -s 256 \
    -e trace=openat,close,dup,dup2,dup3,fcntl,newfstatat,statx,readlink,readlinkat,unlink,unlinkat,rename,renameat,renameat2,read,pread64 \
    -e raw=read,pread64 -o "$out/trace.pipe" \
    bun run ci:test:affected --plan test-impact.json --group "$group" \
    >"$out/log.pipe" 2>&1
result=$?
exec 3>&- 4>&-
wait "$trace_collector"
exit "$result"
