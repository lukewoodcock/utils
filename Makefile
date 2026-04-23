.PHONY: test-unit test-validate test-integration test test-clean

TESTS_DIR := tests

# ── Individual layers ─────────────────────────────────────────────────────────

## Run Jest unit tests (no Docker required)
test-unit:
	@echo "==> Unit tests"
	cd $(TESTS_DIR) && npx jest unit --runInBand

## Run workflow structure validation tests (no Docker required)
test-validate:
	@echo "==> Workflow structure validation"
	cd $(TESTS_DIR) && npx jest validate --runInBand

## Run full integration tests (requires Docker or Podman with compose)
test-integration:
	@echo "==> Integration tests"
	bash $(TESTS_DIR)/integration/run.sh

# ── Combined ──────────────────────────────────────────────────────────────────

## Run unit + validation tests (fast, no Docker)
test-fast: test-unit test-validate

## Run all three test layers
test: test-unit test-validate test-integration
	@echo ""
	@echo "==> All test layers passed"

# ── Cleanup ───────────────────────────────────────────────────────────────────

## Stop test containers and remove the temporary test vault
test-clean:
	@echo "==> Cleaning up test environment"
	docker compose \
		-f docker-compose.yml \
		-f docker-compose.test.yml \
		down -v --remove-orphans 2>/dev/null || true
	rm -rf /tmp/swarm-test-vault
	@echo "==> Done"

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo "Available targets:"
	@grep -E '^##' Makefile | sed 's/## /  /'
