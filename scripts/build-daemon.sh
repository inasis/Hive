#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# 설정: 실행 중인 CLI도, 저장된 실행 정보도, 넘겨받은 인자도 없을 때 사용할 인자
# ============================================================
DEFAULT_ARGS=(daemon --mobile --public-url wss://123.214.207.184/rpc)

PORT="${PORT:-}"             # 지정하면 종료 후 포트 해제까지 대기
HEALTH_URL="${HEALTH_URL:-}" # 지정하면 시작 후 헬스체크

die() { echo "[error] $*" >&2; exit 1; }

# 스크립트 위치와 무관하게 동작: package.json이 나올 때까지 위로 올라가 프로젝트 루트 탐색
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
while [[ ! -f "$ROOT/package.json" && "$ROOT" != / ]]; do ROOT="$(dirname "$ROOT")"; done
[[ -f "$ROOT/package.json" ]] || die "package.json을 찾지 못했습니다. ($SCRIPT_DIR 위쪽)"

STATE="$SCRIPT_DIR/.last-cli-state" # 마지막 실행 정보 (환경변수 포함, 권한 600)
save() { ( umask 077; declare -p CWD CMD ENVS > "$STATE" ); }

# 1. 실행 중인 node CLI 찾기 (래퍼 sh/npm 제외: comm이 node인 것만)
PID=""
for p in $(pgrep -f 'node .*dist/cli\.js' || true); do
    [[ "$(cat "/proc/$p/comm" 2>/dev/null)" == node ]] && { PID=$p; break; }
done

# 2. 실행 정보 확보: 실행 중 > 넘겨받은 인자 > 저장본 > DEFAULT_ARGS
if [[ -n "$PID" ]]; then
    CWD="$(readlink "/proc/$PID/cwd")"
    mapfile -d '' CMD  < "/proc/$PID/cmdline"
    mapfile -d '' ENVS < "/proc/$PID/environ"
    save
    echo "PID: $PID | CWD: $CWD"
elif (($# > 0)) || [[ ! -f "$STATE" ]]; then
    ARGS=("$@")
    ((${#ARGS[@]} > 0)) || ARGS=("${DEFAULT_ARGS[@]}")
    ((${#ARGS[@]} > 0)) || die "실행 중인 CLI, 저장본, 인자, DEFAULT_ARGS가 모두 없습니다."
    CWD="$ROOT"; CMD=(node dist/cli.js "${ARGS[@]}")
    mapfile -d '' ENVS < <(env -0)
    save
    echo "[info] 실행 중인 CLI 없음 → 인자로 시작합니다."
else
    source "$STATE"
    echo "[info] 실행 중인 CLI 없음 → 저장된 실행 정보로 시작합니다."
fi
echo "CMD: ${CMD[*]}"
LOG_FILE="$CWD/cli.log"

# 3. 기존 CLI(있다면)를 살려둔 채 빌드
cd "$CWD"
npm run build || die "빌드 실패. 기존 CLI는 건드리지 않았습니다."

# 4. 기존 CLI 종료 (있을 때만, 프로세스 그룹 단위, 최대 10초 후 SIGKILL)
if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    PGID="$(ps -o pgid= -p "$PID" | tr -d ' ')"
    TARGET="$PID"
    [[ "$PGID" != "$(ps -o pgid= -p $$ | tr -d ' ')" ]] && TARGET="-$PGID"
    kill -- "$TARGET" 2>/dev/null || true
    for _ in $(seq 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$PID" 2>/dev/null; then
        echo "[kill -9] $PID"; kill -9 -- "$TARGET" 2>/dev/null || true
    fi
fi

# 포트를 쓰는 경우 해제될 때까지 대기
if [[ -n "$PORT" ]]; then
    for _ in $(seq 20); do
        [[ -z "$(ss -ltnH "sport = :$PORT")" ]] && break
        sleep 0.5
    done
fi

# 5. 동일한 cwd / 환경 / 명령으로 분리 실행
env -i "${ENVS[@]}" nohup setsid "${CMD[@]}" </dev/null >>"$LOG_FILE" 2>&1 &
NEW_PID=$!
disown "$NEW_PID" 2>/dev/null || true

# 6. 생존 및 헬스 확인 (최대 15초)
for i in $(seq 15); do
    sleep 1
    kill -0 "$NEW_PID" 2>/dev/null || { tail -n 50 "$LOG_FILE"; die "새 CLI가 종료되었습니다."; }
    if [[ -n "$HEALTH_URL" ]]; then
        curl -fsS -o /dev/null "$HEALTH_URL" 2>/dev/null && break
    elif ((i >= 3)); then
        break
    fi
done

echo "완료: OLD ${PID:-none} -> NEW $NEW_PID | 로그: $LOG_FILE"
