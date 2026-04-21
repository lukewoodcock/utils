# Local AI Agent Swarm – Knowledge Graph System

A self-hosted personal knowledge management system powered by **n8n** (workflow
orchestration) and **Ollama** (local LLMs). When you push context from your IDE,
a swarm of three specialised agents runs in parallel and writes structured notes
directly into your **Obsidian** vault, automatically building a linked knowledge
graph.

```
IDE  ──POST──►  n8n Orchestrator
                     │
          ┌──────────┼──────────┐
          ▼          ▼          │  (parallel)
     Documenter   Researcher   │
          │          │          │
          └────┬─────┘          │
               ▼                │
            Linker  ◄───────────┘
               │
          Obsidian Vault  (shared volume)
```

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Docker ≥ 24 **or** Podman ≥ 4.9 + `podman-compose` | — | macOS: use Podman Desktop |
| An Obsidian vault on the host filesystem | — | Can be an empty folder |
| 8 GB RAM | 16 GB recommended | For 7–8 B models |

---

## Quick Start

### 1. Clone / navigate to this directory

```bash
cd /path/to/this/repo
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```dotenv
# Absolute path to your Obsidian vault on the host
VAULT_HOST_PATH=/Users/yourname/Documents/MyVault

# Model to use (must be pulled in step 4)
OLLAMA_MODEL=deepseek-r1:7b
```

### 3. Create vault sub-directories (first time only)

n8n's file-write nodes will error if the target directory does not exist.

```bash
VAULT=/Users/yourname/Documents/MyVault
mkdir -p "$VAULT/code" "$VAULT/research" "$VAULT/logs"
```

### 4. Start the stack

**Docker:**
```bash
docker compose up -d
```

**Podman / macOS:**
```bash
podman-compose up -d
# or with Podman Compose v2+
podman compose up -d
```

### 5. Pull an LLM model into Ollama

Wait for the `ollama` container to be healthy, then pull your chosen model:

```bash
# Docker
docker exec -it ollama ollama pull deepseek-r1:7b

# Podman
podman exec -it ollama ollama pull deepseek-r1:7b
```

Other recommended models (swap `OLLAMA_MODEL` in `.env`):

| Model | VRAM | Speed | Notes |
|-------|------|-------|-------|
| `deepseek-r1:7b` | ~5 GB | fast | good reasoning, default |
| `qwen3:8b` | ~5 GB | fast | strong instruction following |
| `llama3:8b` | ~5 GB | fast | general purpose |
| `mistral:7b` | ~4 GB | fast | lightweight option |

### 6. Open n8n and import the workflows

1. Navigate to `http://localhost:5678`
2. Go to **Workflows → Import from file**
3. Import each file in order:
   - `workflows/01_documenter_agent.json`
   - `workflows/02_researcher_agent.json`
   - `workflows/03_linker_agent.json`
   - `workflows/04_orchestrator.json`
4. **Activate** all four workflows (toggle the switch in the top-right of each).

> The sub-agent workflows (01–03) each expose an internal webhook that the
> Orchestrator calls. They must be active for the Orchestrator to reach them.

### 7. Configure webhook paths (one-time)

After importing, open each sub-agent workflow and note the webhook path n8n
assigned. Update the corresponding `Call … Agent` HTTP Request node in the
Orchestrator (`04`) if the auto-assigned paths differ from:

| Workflow | Expected webhook path |
|----------|-----------------------|
| Documenter | `/webhook/documenter/trigger` |
| Researcher | `/webhook/researcher/trigger` |
| Linker     | `/webhook/linker/trigger`     |
| Orchestrator | `/webhook/knowledge-graph/trigger` |

---

## Triggering the swarm from your IDE

### Webhook endpoint

```
POST http://localhost:5678/webhook/knowledge-graph/trigger
Content-Type: application/json
```

### Payload schema

```jsonc
{
  "file_path":    "src/auth/jwt.py",          // required if description absent
  "language":     "python",                   // optional, defaults to "unknown"
  "description":  "JWT token refresh logic",  // required if file_path absent
  "changed_code": "def refresh_token(...):"   // optional snippet for Documenter
}
```

### Example curl command

```bash
curl -s -X POST http://localhost:5678/webhook/knowledge-graph/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "file_path":    "src/auth/jwt.py",
    "language":     "python",
    "description":  "Implemented JWT token refresh with sliding expiry window",
    "changed_code": "def refresh_token(user_id: str, token: str) -> str:\n    payload = decode_token(token)\n    return create_token(user_id, expiry=3600)"
  }' | jq .
```

### VS Code task (`.vscode/tasks.json`)

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Send to Knowledge Graph",
      "type": "shell",
      "command": "curl",
      "args": [
        "-s", "-X", "POST",
        "http://localhost:5678/webhook/knowledge-graph/trigger",
        "-H", "Content-Type: application/json",
        "-d", "{\"file_path\":\"${relativeFile}\",\"language\":\"${fileExtname}\",\"description\":\"Working on ${fileBasenameNoExtension}\"}"
      ],
      "problemMatcher": []
    }
  ]
}
```

Bind it to a keyboard shortcut in VS Code via **Preferences → Keyboard Shortcuts
→ Tasks: Run Task**.

### JetBrains External Tool

**Preferences → Tools → External Tools → +**

| Field | Value |
|-------|-------|
| Program | `curl` |
| Arguments | `-s -X POST http://localhost:5678/webhook/knowledge-graph/trigger -H "Content-Type: application/json" -d "{\"file_path\":\"$FilePath$\",\"language\":\"$FileExt$\",\"description\":\"Working on $FileName$\"}"` |

---

## Vault structure

```
MyVault/
├── code/          ← Documenter notes  (type: code)
│   └── 2025-04-21_src_auth_jwt_py.md
├── research/      ← Researcher notes  (type: research)
│   └── 2025-04-21_research_JWT_token_refresh_logic.md
└── logs/          ← Session audit log (type: log)
    └── 2025-04-21_session_log.md
```

Every generated note includes YAML frontmatter:

```yaml
---
title: "JWT Token Refresh Implementation"
date: 2025-04-21
tags: [python, jwt, authentication, security]
related: []
source: "ide-webhook"
type: "code"
---
```

The Linker agent appends a `## Related Notes` section with `[[wikilinks]]` so
Obsidian's graph view automatically visualises connections.

---

## Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_HOST_PATH` | `./vault` | Host path to your Obsidian vault |
| `VAULT_PATH` | `/vault` | Container-internal vault path |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `deepseek-r1:7b` | Model used for all LLM calls |
| `N8N_PORT` | `5678` | n8n web UI port |
| `N8N_BASIC_AUTH_ACTIVE` | `false` | Enable HTTP basic auth on n8n UI |
| `N8N_BASIC_AUTH_USER` | `admin` | Basic-auth username |
| `N8N_BASIC_AUTH_PASSWORD` | `changeme` | Basic-auth password |
| `GENERIC_TIMEZONE` / `TZ` | `UTC` | Timezone for note timestamps |

---

## Changing the model

1. Pull the new model: `docker exec -it ollama ollama pull qwen3:8b`
2. Update `OLLAMA_MODEL=qwen3:8b` in `.env`
3. Restart n8n: `docker compose restart n8n`

No workflow edits required — the model name is injected via the environment
variable at runtime.

---

## Stopping the stack

```bash
# Docker
docker compose down

# Podman
podman compose down
```

Data is preserved in the `n8n_data` and `ollama_data` named volumes, and your
vault is on the host filesystem — nothing is lost.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ollama` container unhealthy | Wait 60 s after start; the model download can be slow |
| n8n `ENOENT` on file write | Create the `code/`, `research/`, `logs/` sub-directories in the vault |
| LLM returns empty content | Model not pulled yet — run `docker exec -it ollama ollama pull <model>` |
| Webhook 404 | Sub-agent workflow not activated — toggle the Active switch in n8n |
| `connect ECONNREFUSED n8n:5678` | The Orchestrator's internal calls use `n8n:5678`; ensure all containers are on `swarm_net` |
| Podman permission denied on vault | Run `podman unshare chown -R 1000:1000 /path/to/vault` |

---

## Architecture notes

- **No external API calls.** Every LLM request goes to `http://ollama:11434/api/chat`.
- **Parallel execution.** The Orchestrator fans out to Documenter and Researcher
  simultaneously via n8n's multi-branch output, then merges before calling the
  Linker.
- **Graceful degradation.** If the LLM returns unparseable JSON (Linker) or
  empty content, nodes fall back safely rather than crashing the workflow.
- **Configurable model.** A single `OLLAMA_MODEL` env var controls the model
  used by all three agents.
