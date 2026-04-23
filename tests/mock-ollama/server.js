'use strict';

const express = require('express');
const responses = require('./responses');

const app = express();
app.use(express.json());

// ── State ────────────────────────────────────────────────────────────────────

let activeResponse = null; // null → return 500
let callLog = [];

// Default sequence: documenter first call, researcher second, linker third+
// Callers can override via POST /__test/set-response.
let responseSequence = [];
let sequenceIndex = 0;

// ── Health check (satisfies n8n's Ollama health probe) ───────────────────────

app.get('/api/tags', (_req, res) => {
  res.json({ models: [{ name: 'deepseek-r1:7b', modified_at: new Date().toISOString() }] });
});

// ── Main chat endpoint ───────────────────────────────────────────────────────

app.post('/api/chat', (req, res) => {
  callLog.push({ body: req.body, timestamp: new Date().toISOString() });

  // Use sequence mode if a sequence is set.
  let response;
  if (responseSequence.length > 0) {
    response = responseSequence[sequenceIndex % responseSequence.length];
    sequenceIndex++;
  } else {
    response = activeResponse;
  }

  if (response === null) {
    return res.status(500).json({ error: 'mock error' });
  }

  // If this is the linker call (content is the placeholder) substitute real paths.
  if (response.message && response.message.content === '__LINKER_PLACEHOLDER__') {
    const messages = req.body.messages || [];
    const userMsg  = messages.find(m => m.role === 'user')?.content || '';
    // Extract new_notes paths from the prompt if possible.
    const match = userMsg.match(/New notes just added:\s*(\[.*?\])/s);
    let linkerLinks = [];
    try {
      const notes = JSON.parse(match ? match[1] : '[]');
      linkerLinks = notes.map(n => ({
        new_note_path: n.path || '',
        links_to_add:  [],
      }));
    } catch (_) {
      linkerLinks = [];
    }
    const filled = { ...response, message: { ...response.message, content: JSON.stringify(linkerLinks) } };
    return res.json(filled);
  }

  res.json(response);
});

// ── Test control endpoints ────────────────────────────────────────────────────

// Set a single canned response by name.
app.post('/__test/set-response', (req, res) => {
  const { name, custom } = req.body;
  responseSequence = [];
  sequenceIndex    = 0;
  if (name === null || name === 'error') {
    activeResponse = null;
  } else if (custom) {
    activeResponse = custom;
  } else {
    activeResponse = responses[name] || null;
  }
  res.json({ ok: true, active: name });
});

// Set a sequence of responses (round-robins through them).
app.post('/__test/set-sequence', (req, res) => {
  const { names } = req.body;
  responseSequence = (names || []).map(n => responses[n] || null);
  sequenceIndex    = 0;
  activeResponse   = null;
  res.json({ ok: true, length: responseSequence.length });
});

// Return and reset the call log.
app.get('/__test/calls', (_req, res) => {
  res.json({ calls: callLog });
});

app.post('/__test/reset', (_req, res) => {
  callLog          = [];
  responseSequence = [];
  sequenceIndex    = 0;
  activeResponse   = responses.DOCUMENTER; // safe default
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────

function start(port) {
  return new Promise((resolve) => {
    const server = app.listen(port || process.env.PORT || 11434, () => resolve(server));
  });
}

function stop(server) {
  return new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
}

module.exports = { app, start, stop };

// Allow running as a standalone process.
if (require.main === module) {
  const port = parseInt(process.env.PORT || '11434', 10);
  // Default to DOCUMENTER so health checks pass and basic calls succeed.
  activeResponse = responses.DOCUMENTER;
  start(port).then(() => {
    process.stdout.write(`Mock Ollama listening on port ${port}\n`);
  });
}
