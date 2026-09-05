#!/bin/bash
# Loads Hereld's schema into a local Postgres, in dependency order, with just
# enough of Supabase stubbed to make it possible. Reports per file.
S="$(cd "$(dirname "$0")" && pwd)"
M="$S/../migrations"
P="psql -h /var/run/postgresql -p 5433 -U postgres"
$P -q -c "drop database if exists hereld;" -c "create database hereld;" 2>/dev/null
$P -d hereld -q -v ON_ERROR_STOP=1 -f "$S/00-supabase-stubs.sql" >/dev/null 2>&1
$P -d hereld -q -v ON_ERROR_STOP=1 -f "$S/01-storage-stub.sql" >/dev/null 2>&1
$P -d hereld -q -c "create publication supabase_realtime;" >/dev/null 2>&1
fail=0
for f in 2026-08-29-hereld-core 2026-08-29-hereld-algorithm 2026-08-29-hereld-supernova \
         2026-08-30-hereld-affiliates \
         2026-08-31-hereld-assoc-mark 2026-08-31-hereld-composer 2026-08-30-hereld-features \
         2026-09-01-hereld-bot-fix 2026-09-01-hereld-bot-queue-fix 2026-09-01-hereld-edit \
         2026-09-01-hereld-premium-bots 2026-09-04-hereld-attachments \
         2026-09-04-hereld-edit-columns 2026-09-05-hereld-bot-workers \
         2026-09-05-hereld-bot-grants 2026-09-05-hereld-bot-limits \
         ${EXTRA:-}; do
  [ -f "$M/$f.sql" ] || continue
  out=$($P -d hereld -q -v ON_ERROR_STOP=1 -f "$M/$f.sql" 2>&1)
  if [ $? -eq 0 ]; then echo "ok    $f"; else echo "FAIL  $f"; echo "$out" | grep -i ERROR | head -2; fail=1; fi
done
exit $fail
