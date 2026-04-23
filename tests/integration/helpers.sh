#!/usr/bin/env bash
# Shared helper functions for integration tests.
# Source this file — do not execute directly.

PASS=0
FAIL=0

# ── Logging ───────────────────────────────────────────────────────────────────

log_ok()   { echo "  [PASS] $*"; ((PASS++)); }
log_fail() { echo "  [FAIL] $*" >&2; ((FAIL++)); }
log_info() { echo "  [INFO] $*"; }

assert_exit() {
  if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "Integration tests: $PASS passed, $FAIL failed"
    exit 1
  fi
  echo ""
  echo "Integration tests: $PASS passed, 0 failed"
  exit 0
}

# ── HTTP helpers ──────────────────────────────────────────────────────────────

# Wait for a URL to return HTTP 200. Args: url [max_attempts] [sleep_secs]
wait_for_url() {
  local url="$1"
  local max="${2:-30}"
  local sleep_secs="${3:-2}"
  local attempt=0

  while (( attempt < max )); do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [[ "$code" == "200" ]]; then
      log_info "$url is up (attempt $((attempt+1)))"
      return 0
    fi
    ((attempt++))
    sleep "$sleep_secs"
  done

  log_fail "Timed out waiting for $url (last HTTP code: $code)"
  return 1
}

# POST JSON to a URL and return the response body.
post_json() {
  local url="$1"
  local data="$2"
  curl -s -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$data"
}

# POST JSON and capture both status code and body.
post_json_status() {
  local url="$1"
  local data="$2"
  curl -s -o /tmp/it_response_body.txt -w "%{http_code}" \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$data"
}

# ── n8n API helpers ───────────────────────────────────────────────────────────

N8N_URL="${N8N_URL:-http://localhost:5678}"
N8N_API_KEY="${N8N_API_KEY:-test-api-key-integration}"

n8n_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local args=(-s -X "$method" "${N8N_URL}/api/v1${path}" \
    -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
    -H "Content-Type: application/json")
  if [[ -n "$data" ]]; then
    args+=(-d "$data")
  fi
  curl "${args[@]}"
}

# Import a workflow JSON file and return the assigned workflow ID.
n8n_import() {
  local file="$1"
  local response
  response=$(n8n_api POST /workflows "@${file}")
  echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

# Activate a workflow by ID.
n8n_activate() {
  local wf_id="$1"
  n8n_api PATCH "/workflows/${wf_id}" '{"active":true}' > /dev/null
}

# List all workflow IDs (for cleanup).
n8n_list_ids() {
  n8n_api GET /workflows | grep -o '"id":"[^"]*"' | cut -d'"' -f4
}

# Delete all workflows (used in teardown).
n8n_delete_all() {
  for id in $(n8n_list_ids); do
    n8n_api DELETE "/workflows/${id}" > /dev/null 2>&1 || true
  done
}

# ── Vault assertion helpers ───────────────────────────────────────────────────

VAULT_PATH="${VAULT_HOST_PATH:-/tmp/swarm-test-vault}"

# Wait for at least one file matching a glob pattern to appear.
# Args: directory glob [max_attempts]
vault_file_exists() {
  local dir="$1"
  local pattern="$2"
  local max="${3:-20}"
  local attempt=0

  while (( attempt < max )); do
    local found
    found=$(find "$dir" -name "$pattern" 2>/dev/null | head -1)
    if [[ -n "$found" ]]; then
      echo "$found"
      return 0
    fi
    ((attempt++))
    sleep 2
  done

  log_fail "No file matching '$pattern' appeared in $dir after $((max * 2))s"
  return 1
}

# Assert a file contains a YAML frontmatter key (e.g. "title:").
assert_frontmatter() {
  local file="$1"
  shift
  for key in "$@"; do
    if grep -q "^${key}:" "$file" 2>/dev/null; then
      log_ok "frontmatter key '${key}' present in $(basename "$file")"
    else
      log_fail "frontmatter key '${key}' MISSING in $(basename "$file")"
    fi
  done
}

# Assert a file contains a [[wikilink]] pattern.
assert_wikilinks() {
  local file="$1"
  if grep -qP '\[\[.+\]\]' "$file" 2>/dev/null; then
    log_ok "wikilinks found in $(basename "$file")"
  else
    log_fail "No [[wikilinks]] found in $(basename "$file")"
  fi
}

# Assert a file contains a specific string.
assert_contains() {
  local file="$1"
  local pattern="$2"
  local label="${3:-$pattern}"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    log_ok "'${label}' found in $(basename "$file")"
  else
    log_fail "'${label}' NOT found in $(basename "$file")"
  fi
}

# ── Docker Compose helpers ────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

compose_up() {
  docker compose \
    -f "${REPO_ROOT}/docker-compose.yml" \
    -f "${REPO_ROOT}/docker-compose.test.yml" \
    up -d --build 2>&1
}

compose_down() {
  docker compose \
    -f "${REPO_ROOT}/docker-compose.yml" \
    -f "${REPO_ROOT}/docker-compose.test.yml" \
    down -v --remove-orphans 2>/dev/null || true
  rm -rf /tmp/swarm-test-vault
}
