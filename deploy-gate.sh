#!/usr/bin/env bash
# deploy-gate.sh - pre-restart safety gate for dandiya-nights ONLY.
# Decoupled 2026-10-17: dandiya-nights and dandiya-nights are independent apps.
# Run before: pm2 restart dandiya-nights
# Rollback:  bash /opt/dandiya-nights/deploy-gate.sh --rollback
set -u
SITE=dandiya-nights
if [ "${1:-}" = "--rollback" ]; then
  f=/opt/$SITE/server/public/index.html
  bak=$(ls -t ${f}.bak-* 2>/dev/null | head -1)
  [ -n "$bak" ] && cp "$bak" "$f" && echo "rolled back $f <- $bak"
  pm2 restart $SITE --update-env >/dev/null 2>&1
  echo "ROLLBACK DONE"; exit 0
fi
fail=0
f=/opt/$SITE/server/public/index.html
rm -f /tmp/gate_${SITE}_*.js
node -e "const fs=require('fs');const h=fs.readFileSync('$f','utf8');const m=[...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];m.forEach((x,i)=>fs.writeFileSync('/tmp/gate_${SITE}_'+i+'.js',x[1]));console.log('extracted',m.length,'inline scripts')"
for j in /tmp/gate_${SITE}_*.js; do
  [ -e "$j" ] || continue
  if ! node --check "$j" 2>/tmp/gateerr; then
    echo "GATE-FAIL $SITE $(basename $j): $(grep -m1 Error /tmp/gateerr | cut -c1-100)"
    fail=1
  fi
done
if [ "$fail" = 1 ]; then
  echo "GATE FAILED - do NOT restart pm2. Fix or run: bash $0 --rollback"
  exit 1
fi
echo "GATE OK - safe to: pm2 restart $SITE"
