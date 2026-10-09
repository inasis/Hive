#!/usr/bin/env bash
set -e

while pgrep -f 'artifacts/daemon/hive-linux-x64' >/dev/null; do
    pkill -f 'artifacts/daemon/hive-linux-x64' 2>/dev/null || true
    sleep 1
done

echo "Hive Daemon stopped."

npm run daemon:build
nohup artifacts/daemon/hive-linux-x64 daemon \
    --public-url wss://123.214.207.184/rpc \
    > hive-daemon.log 2>&1 &

disown

echo "Hive Daemon started. PID: $!"
