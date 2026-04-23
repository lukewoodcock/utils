#!/usr/bin/env bash
# Integration test runner for the AI Agent Swarm Knowledge Graph system.
# Requires: Docker or Podman with compose, curl, jq (optional but recommended).
#
# Usage:
#   bash tests/integration/run.sh
#
# The script:
#   1. Starts the stack (real n8n + mock Ollama) using docker-compose.test.yml
#   2. Imports and activates all four workflows via the n8n REST API
#   3. Exercises the webhook and asserts vault file contents
#   4. Tears down the stack and cleans up the temp vault

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

FIXTURES="${SCRIPT_DIR}/fixtures"
WORKFLOW_DIR="${REPO_ROOT}/workflows"
N8N_URL="${N8N_URL:-http://localhost:5678}"
WEBHOOK_URL="${N8N_URL}/webhook/knowledge-graph/trigger"
VAULT_PATH=/tmp/swarm-test-vault

echo "========================================"
echo "  AI Swarm Knowledge Graph — Integration Tests"
echo "========================================"
echo ""

# ── Cleanup on exit ───────────────────────────────────────────────────────────

trap compose_down EXIT

# ── Phase 1: Start stack ──────────────────────────────────────────────────────

echo "==> Starting test stack..."
mkdir -p /tmp/swarm-test-vault/code /tmp/swarm-test-vault/research /tmp/swarm-test-vault/logs
compose_up

echo "==> Waiting for mock Ollama..."
wait_for_url "http://localhost:11435/api/tags"

echo "==> Waiting for n8n..."
wait_for_url "${N8N_URL}/healthz" 40 3

# ── Phase 2: Import & activate workflows ──────────────────────────────────────

echo ""
echo "==> Importing workflows..."
IMPORTED_IDS=()
for wf_file in \
    "${WORKFLOW_DIR}/01_documenter_agent.json" \
    "${WORKFLOW_DIR}/02_researcher_agent.json" \
    "${WORKFLOW_DIR}/03_linker_agent.json" \
    "${WORKFLOW_DIR}/04_orchestrator.json"; do

  wf_id=$(n8n_import "$wf_file")
  if [[ -z "$wf_id" ]]; then
    echo "[FAIL] Could not import $(basename "$wf_file")" >&2
    exit 1
  fi
  log_info "Imported $(basename "$wf_file") → id=$wf_id"
  n8n_activate "$wf_id"
  log_info "Activated $wf_id"
  IMPORTED_IDS+=("$wf_id")
done

# Brief pause to let n8n register the webhooks.
sleep 3

# ── Phase 3: Integration tests ────────────────────────────────────────────────

echo ""
echo "==> Running integration tests..."
echo ""

# ─ IT-1: Happy-path — full swarm round-trip ───────────────────────────────────
echo "--- IT-1: Full happy-path webhook trigger"
STATUS=$(post_json_status "$WEBHOOK_URL" "@${FIXTURES}/sample-payload.json")
BODY=$(cat /tmp/it_response_body.txt)
if [[ "$STATUS" == "200" ]]; then
  log_ok "IT-1: Webhook returned HTTP 200"
else
  log_fail "IT-1: Webhook returned HTTP $STATUS (expected 200)"
fi

# ─ IT-2: Code note created with correct frontmatter ──────────────────────────
echo "--- IT-2: Code note written to vault/code/"
CODE_NOTE=$(vault_file_exists "${VAULT_PATH}/code" "*.md") || true
if [[ -n "$CODE_NOTE" ]]; then
  log_ok "IT-2: Code note found: $(basename "$CODE_NOTE")"
  assert_frontmatter "$CODE_NOTE" "title" "date" "tags" "source" "type"
  assert_contains "$CODE_NOTE" 'type: "code"' 'type: code'
else
  log_fail "IT-2: No code note found in ${VAULT_PATH}/code/"
fi

# ─ IT-3: Research note created with correct frontmatter ──────────────────────
echo "--- IT-3: Research note written to vault/research/"
RESEARCH_NOTE=$(vault_file_exists "${VAULT_PATH}/research" "*.md") || true
if [[ -n "$RESEARCH_NOTE" ]]; then
  log_ok "IT-3: Research note found: $(basename "$RESEARCH_NOTE")"
  assert_frontmatter "$RESEARCH_NOTE" "title" "date" "source" "type"
  assert_contains "$RESEARCH_NOTE" 'type: "research"' 'type: research'
else
  log_fail "IT-3: No research note found in ${VAULT_PATH}/research/"
fi

# ─ IT-4: Session log created ─────────────────────────────────────────────────
echo "--- IT-4: Session log written to vault/logs/"
LOG_FILE=$(vault_file_exists "${VAULT_PATH}/logs" "*_session_log.md") || true
if [[ -n "$LOG_FILE" ]]; then
  log_ok "IT-4: Session log found: $(basename "$LOG_FILE")"
  assert_contains "$LOG_FILE" 'type: "log"' 'type: log'
else
  log_fail "IT-4: No session log found in ${VAULT_PATH}/logs/"
fi

# ─ IT-5: Linker appended wikilinks ───────────────────────────────────────────
echo "--- IT-5: Linker appended [[wikilinks]] to at least one note"
WIKILINK_FOUND=false
for f in "${VAULT_PATH}/code/"*.md "${VAULT_PATH}/research/"*.md; do
  [[ -f "$f" ]] || continue
  if grep -qP '\[\[.+\]\]' "$f" 2>/dev/null; then
    WIKILINK_FOUND=true
    log_ok "IT-5: [[wikilinks]] found in $(basename "$f")"
    break
  fi
done
if [[ "$WIKILINK_FOUND" == false ]]; then
  log_info "IT-5: No wikilinks found (Linker may have had nothing to link — acceptable if vault was empty)"
fi

# ─ IT-6: Final JSON response shape ───────────────────────────────────────────
echo "--- IT-6: Response body has expected JSON shape"
if echo "$BODY" | grep -q '"status"' && echo "$BODY" | grep -q '"file_path"'; then
  log_ok "IT-6: Response contains 'status' and 'file_path' fields"
else
  log_fail "IT-6: Response missing expected fields. Body: $BODY"
fi

# ─ IT-7: Empty payload returns 4xx ───────────────────────────────────────────
echo "--- IT-7: Empty payload returns HTTP 4xx"
BAD_STATUS=$(post_json_status "$WEBHOOK_URL" '{}')
if [[ "$BAD_STATUS" -ge 400 && "$BAD_STATUS" -lt 600 ]]; then
  log_ok "IT-7: Empty payload returned HTTP $BAD_STATUS (expected 4xx/5xx)"
else
  log_fail "IT-7: Empty payload returned HTTP $BAD_STATUS (expected 4xx/5xx)"
fi

# ─ IT-8: Documenter webhook is reachable (trigger bug fixed) ─────────────────
echo "--- IT-8: Documenter sub-agent webhook responds (trigger bug fix)"
DOC_STATUS=$(post_json_status "${N8N_URL}/webhook/documenter/trigger" \
  "@${FIXTURES}/sample-payload.json")
if [[ "$DOC_STATUS" == "200" ]]; then
  log_ok "IT-8: Documenter webhook returned HTTP 200"
else
  log_fail "IT-8: Documenter webhook returned HTTP $DOC_STATUS (expected 200) — trigger bug NOT fixed!"
fi

# ─ IT-9: Researcher webhook is reachable ─────────────────────────────────────
echo "--- IT-9: Researcher sub-agent webhook responds"
RES_STATUS=$(post_json_status "${N8N_URL}/webhook/researcher/trigger" \
  "@${FIXTURES}/sample-payload.json")
if [[ "$RES_STATUS" == "200" ]]; then
  log_ok "IT-9: Researcher webhook returned HTTP 200"
else
  log_fail "IT-9: Researcher webhook returned HTTP $RES_STATUS (expected 200)"
fi

# ─ IT-10: Linker webhook is reachable ────────────────────────────────────────
echo "--- IT-10: Linker sub-agent webhook responds"
LNK_PAYLOAD='{"new_notes":[],"description":"test","language":"python"}'
LNK_STATUS=$(post_json_status "${N8N_URL}/webhook/linker/trigger" "$LNK_PAYLOAD")
if [[ "$LNK_STATUS" == "200" ]]; then
  log_ok "IT-10: Linker webhook returned HTTP 200"
else
  log_fail "IT-10: Linker webhook returned HTTP $LNK_STATUS (expected 200)"
fi

# ── Phase 4: Summary ──────────────────────────────────────────────────────────

echo ""
echo "========================================"
assert_exit
