#!/usr/bin/env bash
# Puts back bun.lock and e2e/bun.lock after a push that broke them (AI Studio syncs replace the
# root lock with its starter lock and sometimes delete e2e/bun.lock).
#
#   scripts/repair-lockfiles.sh <good-ref>
#
# <good-ref> is where to start looking for a good lock (CI passes the commit before the push).
# A lock that's missing or doesn't match its package.json is replaced by the newest version of it,
# at <good-ref> or earlier, that matches package.json as it is now, so every version stays pinned.
# If none does (package.json itself changed), the newest one is reconciled with `bun install`.
# Prints the files it changed; prints nothing when both locks were already fine.
set -euo pipefail

good=${1:?usage: scripts/repair-lockfiles.sh <good-ref>}
root=$(git rev-parse --show-toplevel)
changed=()

# repair <dir>: fix <dir>/bun.lock against <dir>/package.json.
repair() {
  local dir=$1 lock=$1/bun.lock
  lock=${lock#./}
  if [ -f "$root/$lock" ] && (cd "$root/$dir" && bun install --frozen-lockfile >/dev/null 2>&1); then
    return 0
  fi
  local rev newest=
  # The commits that changed this lock, newest first; the lock as each one left it.
  for rev in $(git -C "$root" log -n 15 --format=%H "$good" -- "$lock"); do
    git -C "$root" cat-file -e "$rev:$lock" 2>/dev/null || continue
    newest=${newest:-$rev}
    git -C "$root" show "$rev:$lock" > "$root/$lock"
    if (cd "$root/$dir" && bun install --frozen-lockfile >/dev/null 2>&1); then
      changed+=("$lock")
      return 0
    fi
  done
  if [ -n "$newest" ]; then git -C "$root" show "$newest:$lock" > "$root/$lock"; else rm -f "$root/$lock"; fi
  (cd "$root/$dir" && bun install >/dev/null)
  (cd "$root/$dir" && bun install --frozen-lockfile >/dev/null)
  changed+=("$lock")
}

repair .
repair e2e
[ ${#changed[@]} -eq 0 ] || printf '%s\n' "${changed[@]}"
