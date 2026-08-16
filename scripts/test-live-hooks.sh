#!/usr/bin/env bash
# Live test of the 0.2.7 packaged build: boot the app headless, confirm the
# hook installer writes Claude hooks pointing at a live loopback server, then
# POST a lifecycle event and confirm it's accepted. Fail-open checks too.
set -u
cd /home/dazeb/workspace/projects/active/termsprawl

# Snapshot the current settings.json so we can restore it after.
SETTINGS=~/.claude/settings.json
BACKUP=$(mktemp)
[ -f "$SETTINGS" ] && cp "$SETTINGS" "$BACKUP"
# Clear any stale file so FOUND below only triggers on a FRESH write by this
# app instance (the loopback port changes every launch).
rm -f "$SETTINGS"

LOG=$(mktemp)
PIDFILE=$(mktemp)

# Boot the packaged app headless in the background (within this script).
xvfb-run -a npx electron dist/linux-unpacked/resources/app.asar --no-sandbox >"$LOG" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$PIDFILE"

# Wait for settings.json to be written by the hook installer (max 15s).
FOUND=0
for _ in $(seq 1 30); do
  if [ -f "$SETTINGS" ] && grep -q "hook/claude" "$SETTINGS" 2>/dev/null; then
    FOUND=1
    break
  fi
  sleep 0.5
done

if [ "$FOUND" -eq 0 ]; then
  echo "FAIL: hooks were not installed within 15s"
  echo "--- app log ---"
  grep -viE "zle|dbus|gpu|vaapi|libva" "$LOG" | head -20
  exit 1
fi

echo "PASS: hooks installed"
URL=$(python3 -c "import json; d=json.load(open('$SETTINGS')); print(d['hooks']['Stop'][0]['hooks'][0]['url'])")
echo "      server url: $URL"

# Live POSTs against the running server.
echo "--- live POSTs ---"
curl -s -o /dev/null -w "  Stop (valid)     -> HTTP %{http_code}\n" -X POST "$URL" \
  -H 'content-type: application/json' \
  -d '{"hook_event_name":"Stop","session_id":"test-node-1"}'
curl -s -o /dev/null -w "  PreToolUse       -> HTTP %{http_code}\n" -X POST "$URL" \
  -H 'content-type: application/json' \
  -d '{"hook_event_name":"PreToolUse","session_id":"test-node-1","tool_name":"Bash"}'
curl -s -o /dev/null -w "  malformed json   -> HTTP %{http_code}\n" -X POST "$URL" -d 'not json'
curl -s -o /dev/null -w "  GET method       -> HTTP %{http_code}\n" "$URL"

echo "--- settings events ---"
python3 -c "import json; d=json.load(open('$SETTINGS')); print('  ', sorted(d['hooks'].keys()))"

# Cleanup: kill the app and restore the previous settings.json.
kill "$APP_PID" 2>/dev/null
pkill -f "electron.*app.asar" 2>/dev/null
pkill -f "xvfb-run" 2>/dev/null
sleep 1
if [ -s "$BACKUP" ]; then
  cp "$BACKUP" "$SETTINGS"
  echo "restored previous settings.json"
else
  rm -f "$SETTINGS"
  echo "removed test settings.json (none existed before)"
fi
rm -f "$BACKUP" "$LOG" "$PIDFILE"
echo "DONE"
