#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/.env"
  set +a
fi

SERVER_PORT="${SERVER_PORT:-${PORT:-4000}}"
WEB_PORT="${WEB_PORT:-8484}"

RUNTIME_DIR="${ROOT_DIR}/.dev-runtime"
PLAYWRIGHT_BIN_DIR="${ROOT_DIR}/.playwright-bin"
SERVER_APP_DIR="${ROOT_DIR}/apps/server"
WEB_APP_DIR="${ROOT_DIR}/apps/web"

# Load repo-root .env (if present) BEFORE computing defaults so users can
# override HOST/PORT/WEB_PORT/etc. without editing this script. .env is
# git-ignored — see .env.example for the documented variable list.
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

SERVER_BIND_HOST="${SERVER_BIND_HOST:-0.0.0.0}"
SERVER_PUBLIC_HOST="${SERVER_PUBLIC_HOST:-127.0.0.1}"
# The Vite proxy runs on this host. Keep its default upstream on loopback;
# SERVER_PUBLIC_HOST is only for LAN clients and must not overwrite a remote
# backend override from .env.
WEB_BACKEND_HOST="${WEB_BACKEND_HOST:-127.0.0.1}"
WEB_BACKEND_PORT="${WEB_BACKEND_PORT:-$SERVER_PORT}"

WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_HTTPS="${WEB_HTTPS:-1}"
WEB_HTTPS_CERT="${WEB_HTTPS_CERT:-${RUNTIME_DIR}/certs/dev-cert.pem}"
WEB_HTTPS_KEY="${WEB_HTTPS_KEY:-${RUNTIME_DIR}/certs/dev-key.pem}"
WEB_HTTPS_SAN="${WEB_HTTPS_SAN:-}"
WEB_HTTPS_CA_CERT="${WEB_HTTPS_CA_CERT:-}"
TERMINAL_SCROLLBACK_BYTES="${TERMINAL_SCROLLBACK_BYTES:-4194304}"
TERMINAL_TMUX_CAPTURE_LINES="${TERMINAL_TMUX_CAPTURE_LINES:-5000}"
TERMINAL_REGISTRY_OUTPUT_ENTRIES="${TERMINAL_REGISTRY_OUTPUT_ENTRIES:-1000}"
VITE_TERMINAL_SCROLLBACK_LINES="${VITE_TERMINAL_SCROLLBACK_LINES:-20000}"
SESSION_STATE_PATH="${SESSION_STATE_PATH:-${RUNTIME_DIR}/agent-sessions.json}"
APP_SOURCE_ROOT="${APP_SOURCE_ROOT:-${ROOT_DIR}}"

SERVER_LOG="${RUNTIME_DIR}/server.log"
WEB_LOG="${RUNTIME_DIR}/web.log"
SERVER_PID_FILE="${RUNTIME_DIR}/server.pid"
WEB_PID_FILE="${RUNTIME_DIR}/web.pid"

log() {
  printf '[dev-restart] %s\n' "$*"
}

build_runtime_path() {
  # .playwright-bin is only for E2E tests (playwright.config.ts adds it).
  # Do NOT prepend it here; it shadows real binaries like copilot.
  printf '%s\n' "$PATH"
}

kill_from_pid_file() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 -- "$pid" 2>/dev/null; then
    log "Stopping ${name} process ${pid}"
    kill -- "$pid" 2>/dev/null || true
    sleep 0.3

    if kill -0 -- "$pid" 2>/dev/null; then
      kill -9 -- "$pid" 2>/dev/null || true
    fi
  fi

  rm -f "$pid_file"
}

pid_belongs_to_repo() {
  local pid="$1"
  local cwd
  local cmdline

  cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)"
  if [[ "$cwd" == "$ROOT_DIR" || "$cwd" == "$ROOT_DIR/"* ]]; then
    return 0
  fi

  cmdline="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
  if [[ "$cmdline" == *"$ROOT_DIR"* ]]; then
    return 0
  fi

  return 1
}

has_repo_listener_on_port() {
  local port="$1"
  local pids=()
  local pid

  while IFS= read -r pid; do
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
      pids+=("$pid")
    fi
  done < <(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)

  for pid in "${pids[@]}"; do
    if pid_belongs_to_repo "$pid"; then
      return 0
    fi
  done

  return 1
}

kill_listeners_on_port() {
  local name="$1"
  local port="$2"
  local pids=()
  local repo_pids=()
  local foreign_pids=()
  local pid
  local force_pid_list

  while IFS= read -r pid; do
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
      pids+=("$pid")
    fi
  done < <(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)

  if (( ${#pids[@]} == 0 )); then
    return
  fi

  for pid in "${pids[@]}"; do
    if pid_belongs_to_repo "$pid"; then
      repo_pids+=("$pid")
    else
      foreign_pids+=("$pid")
    fi
  done

  if (( ${#repo_pids[@]} > 0 && ${#foreign_pids[@]} > 0 )); then
    log "Freeing ${name} port ${port}: repo listeners ${repo_pids[*]}, foreign listeners ${foreign_pids[*]}"
  elif (( ${#foreign_pids[@]} > 0 )); then
    log "Freeing ${name} port ${port}: foreign listeners ${foreign_pids[*]}"
  else
    log "Freeing ${name} port ${port}: ${repo_pids[*]}"
  fi

  kill -- "${pids[@]}" 2>/dev/null || true
  sleep 0.3

  pids=()
  while IFS= read -r pid; do
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
      pids+=("$pid")
    fi
  done < <(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)

  if (( ${#pids[@]} > 0 )); then
    printf -v force_pid_list '%s, ' "${pids[@]}"
    force_pid_list="${force_pid_list%, }"
    log "Force killing ${name} port ${port}: ${force_pid_list}"
    kill -9 -- "${pids[@]}" 2>/dev/null || true
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"
  local curl_args=(--noproxy '*' -fsS)

  if [[ "$url" == https://* ]]; then
    curl_args=(--noproxy '*' -k -fsS)
  fi

  for ((i = 1; i <= attempts; i += 1)); do
    if curl "${curl_args[@]}" "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.3
  done

  log "${name} did not become ready: ${url}"
  return 1
}

extract_frontend_url() {
  local label="$1"
  local file="$2"
  local all_urls

  all_urls="$(sed -nE "s/.*${label}:[[:space:]]+(https?:\/\/[^[:space:]]+).*/\1/p" "$file" \
    | tr -d '\r' \
    | sed 's:/$::')"

  # Prefer localhost / 127.0.0.1; fall back to first URL
  printf '%s\n' "$all_urls" | grep -E '//localhost[:/]|//127\.0\.0\.1[:/]' | head -n 1 \
    || printf '%s\n' "$all_urls" | head -n 1
}

wait_for_frontend_urls() {
  local file="$1"
  local attempts="${2:-60}"

  FRONTEND_LOCAL_URL=''
  FRONTEND_NETWORK_URL=''

  for ((i = 1; i <= attempts; i += 1)); do
    FRONTEND_LOCAL_URL="$(extract_frontend_url Local "$file")"
    FRONTEND_NETWORK_URL="$(extract_frontend_url Network "$file")"

    if [[ -n "$FRONTEND_LOCAL_URL" ]]; then
      return 0
    fi

    sleep 0.3
  done

  log 'frontend did not print a ready url'
  return 1
}

extract_url_port() {
  local url="$1"

  printf '%s\n' "$url" | sed -nE 's#.*:([0-9]+)$#\1#p'
}

show_log_tail() {
  local label="$1"
  local file="$2"

  if [[ -f "$file" ]]; then
    printf '\n[%s log tail]\n' "$label"
    tail -n 20 "$file" || true
  fi
}

capture_current_session_state() {
  local sessions_url="http://${SERVER_PUBLIC_HOST}:${SERVER_PORT}/api/agent-sessions"

  if ! has_repo_listener_on_port "$SERVER_PORT"; then
    log "No running repo backend needs migration"
    return 0
  fi

  if node "${ROOT_DIR}/scripts/capture-session-state.mjs" \
    "$sessions_url" "$SESSION_STATE_PATH"; then
    log "Captured current session registry before restart"
    return 0
  else
    log "Refusing to restart: active repo backend state could not be migrated"
    return 1
  fi
}

build_default_https_san() {
  local san_entries=("DNS:localhost" "IP:127.0.0.1")
  local host_name
  local ip

  host_name="$(hostname -s 2>/dev/null || hostname 2>/dev/null || true)"
  if [[ -n "$host_name" && "$host_name" != "localhost" ]]; then
    san_entries+=("DNS:${host_name}")
  fi

  for ip in $(hostname -I 2>/dev/null || true); do
    if [[ -z "$ip" || "$ip" == 127.* || "$ip" == "::1" ]]; then
      continue
    fi

    san_entries+=("IP:${ip}")
  done

  local IFS=,
  printf '%s\n' "${san_entries[*]}"
}

verify_https_ca_cert() {
  local candidate="$1"

  [[ -r "$candidate" ]] || return 1
  openssl x509 -in "$candidate" -noout -text 2>/dev/null \
    | grep -q 'CA:TRUE' || return 1
  openssl verify -CAfile "$candidate" "$WEB_HTTPS_CERT" >/dev/null 2>&1
}

resolve_mkcert_ca_cert() {
  local ca_root
  local candidate

  command -v mkcert >/dev/null 2>&1 || return 0
  ca_root="$(mkcert -CAROOT 2>/dev/null || true)"
  [[ -n "$ca_root" ]] || return 0
  candidate="${ca_root}/rootCA.pem"

  if verify_https_ca_cert "$candidate"; then
    # Keep this explicit verification here: only the CA that signed the
    # currently served leaf certificate may be offered to browser clients.
    openssl verify -CAfile "$candidate" "$WEB_HTTPS_CERT" >/dev/null 2>&1
    printf '%s\n' "$candidate"
  fi
}

main() {
  if [[ -z "$WEB_HTTPS_SAN" ]]; then
    WEB_HTTPS_SAN="$(build_default_https_san)"
  fi

  mkdir -p "$RUNTIME_DIR"

  if ! WEB_HTTPS="$WEB_HTTPS" WEB_HTTPS_CERT="$WEB_HTTPS_CERT" WEB_HTTPS_KEY="$WEB_HTTPS_KEY" WEB_HTTPS_SAN="$WEB_HTTPS_SAN" \
    node "${ROOT_DIR}/scripts/ensure-dev-https-cert.mjs"; then
    exit 1
  fi

  if [[ "$WEB_HTTPS" == "1" ]]; then
    if [[ -n "$WEB_HTTPS_CA_CERT" ]]; then
      if ! verify_https_ca_cert "$WEB_HTTPS_CA_CERT"; then
        log "WEB_HTTPS_CA_CERT must be a CA certificate that verifies WEB_HTTPS_CERT"
        exit 1
      fi
    else
      WEB_HTTPS_CA_CERT="$(resolve_mkcert_ca_cert)"
    fi
  fi

  if ! capture_current_session_state; then
    exit 1
  fi

  kill_listeners_on_port backend "$SERVER_PORT"
  kill_listeners_on_port frontend "$WEB_PORT"
  kill_from_pid_file backend "$SERVER_PID_FILE"
  kill_from_pid_file frontend "$WEB_PID_FILE"

  : >"$SERVER_LOG"
  : >"$WEB_LOG"

  cd "$ROOT_DIR"

  RUNTIME_PATH="$(build_runtime_path)"

  log "Starting backend on ${SERVER_BIND_HOST}:${SERVER_PORT}"
  setsid env -u VSCODE_IPC_HOOK_CLI PATH="$RUNTIME_PATH" SERVER_BIND_HOST="$SERVER_BIND_HOST" HOST="$SERVER_BIND_HOST" PORT="$SERVER_PORT" SERVER_PORT="$SERVER_PORT" \
    SESSION_STATE_PATH="$SESSION_STATE_PATH" APP_SOURCE_ROOT="$APP_SOURCE_ROOT" \
    CHOKIDAR_USEPOLLING=1 \
    TERMINAL_SCROLLBACK_BYTES="$TERMINAL_SCROLLBACK_BYTES" TERMINAL_TMUX_CAPTURE_LINES="$TERMINAL_TMUX_CAPTURE_LINES" TERMINAL_REGISTRY_OUTPUT_ENTRIES="$TERMINAL_REGISTRY_OUTPUT_ENTRIES" \
    pnpm --dir "$SERVER_APP_DIR" dev >"$SERVER_LOG" 2>&1 < /dev/null &
  echo $! >"$SERVER_PID_FILE"

  SERVER_URL="http://${SERVER_PUBLIC_HOST}:${SERVER_PORT}"
  SERVER_HEALTH_URL="${SERVER_URL}/api/health"

  log "Waiting for backend to be ready…"
  if ! wait_for_http backend "$SERVER_HEALTH_URL"; then
    show_log_tail backend "$SERVER_LOG"
    exit 1
  fi
  log "Backend ready ✓"

  log "Starting frontend on ${WEB_HOST}:${WEB_PORT}"
  if [[ "$WEB_HTTPS" == "1" ]]; then
    log "Frontend HTTPS enabled"
    setsid env -u VSCODE_IPC_HOOK_CLI PATH="$RUNTIME_PATH" WEB_BACKEND_HOST="$WEB_BACKEND_HOST" WEB_BACKEND_PORT="$WEB_BACKEND_PORT" SERVER_PORT="$SERVER_PORT" PORT="$SERVER_PORT" \
      CHOKIDAR_USEPOLLING=1 \
      VITE_DEV_HTTPS=1 VITE_DEV_HTTPS_CERT="$WEB_HTTPS_CERT" VITE_DEV_HTTPS_KEY="$WEB_HTTPS_KEY" VITE_DEV_HTTPS_CA_CERT="$WEB_HTTPS_CA_CERT" \
      VITE_TERMINAL_SCROLLBACK_LINES="$VITE_TERMINAL_SCROLLBACK_LINES" \
      pnpm --dir "$WEB_APP_DIR" exec vite --host "$WEB_HOST" --port "$WEB_PORT" \
      >"$WEB_LOG" 2>&1 < /dev/null &
  else
    setsid env -u VSCODE_IPC_HOOK_CLI PATH="$RUNTIME_PATH" WEB_BACKEND_HOST="$WEB_BACKEND_HOST" WEB_BACKEND_PORT="$WEB_BACKEND_PORT" SERVER_PORT="$SERVER_PORT" PORT="$SERVER_PORT" \
      CHOKIDAR_USEPOLLING=1 \
      VITE_TERMINAL_SCROLLBACK_LINES="$VITE_TERMINAL_SCROLLBACK_LINES" pnpm --dir "$WEB_APP_DIR" exec vite --host "$WEB_HOST" --port "$WEB_PORT" \
      >"$WEB_LOG" 2>&1 < /dev/null &
  fi
  echo $! >"$WEB_PID_FILE"

  (
    if ! wait_for_frontend_urls "$WEB_LOG"; then
      exit 1
    fi
    FRONTEND_LOCAL_URL="$(extract_frontend_url Local "$WEB_LOG")"
    FRONTEND_READY_URL="${FRONTEND_LOCAL_URL}/@vite/client"
    if ! wait_for_http frontend "$FRONTEND_READY_URL"; then
      exit 1
    fi
  ) &
  FRONTEND_WAIT_PID=$!

  if ! wait "$FRONTEND_WAIT_PID"; then
    show_log_tail frontend "$WEB_LOG"
    exit 1
  fi

  # Re-extract URLs after parallel wait (subshell can't export)
  wait_for_frontend_urls "$WEB_LOG" 5

  FRONTEND_PORT="$(extract_url_port "$FRONTEND_LOCAL_URL")"
  if [[ -n "$FRONTEND_PORT" && "$FRONTEND_PORT" != "$WEB_PORT" ]]; then
    log "Requested frontend port ${WEB_PORT} was busy; Vite selected ${FRONTEND_PORT}"
  fi

  printf '\nBackend  : %s\n' "$SERVER_URL"
  printf 'Health   : %s\n' "$SERVER_HEALTH_URL"
  printf 'Frontend : %s\n' "$FRONTEND_LOCAL_URL"
  if [[ -n "$FRONTEND_NETWORK_URL" ]]; then
    printf 'Network  : %s\n' "$FRONTEND_NETWORK_URL"
  fi
  if [[ "$WEB_HTTPS" == "1" && -n "$WEB_HTTPS_CA_CERT" ]]; then
    printf 'HTTPS CA : %s%s\n' "${FRONTEND_NETWORK_URL:-$FRONTEND_LOCAL_URL}" "/__coding-kanban/https-ca.crt"
  fi
  printf 'Logs     : %s | %s\n' "$SERVER_LOG" "$WEB_LOG"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
