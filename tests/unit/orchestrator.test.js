'use strict';

const { makeN8nContext, runCode } = require('./helpers/n8n-mock');

const workflow = require('../../workflows/04_orchestrator.json');

function getCode(nodeName) {
  const node = workflow.nodes.find(n => n.name === nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found in workflow`);
  return node.parameters.jsCode;
}

const VALIDATE   = getCode('Validate & Normalise Input');
const BUILD_LINKER = getCode('Build Linker Context');

const FIXED_DATE = '2025-04-21';
const FIXED_ENV  = { VAULT_PATH: '/vault', OLLAMA_URL: 'http://ollama:11434', OLLAMA_MODEL: 'deepseek-r1:7b' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${FIXED_DATE}T12:00:00Z`));
});
afterEach(() => { jest.useRealTimers(); });

// ── Validate & Normalise Input ───────────────────────────────────────────────

describe('Orchestrator – Validate & Normalise Input', () => {
  test('throws when both file_path and description are absent', () => {
    const ctx = makeN8nContext({ inputItem: {}, env: FIXED_ENV });
    expect(() => runCode(VALIDATE, ctx)).toThrow(
      'Payload must include at least one of: file_path, description'
    );
  });

  test('accepts payload with only file_path', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'src/foo.py' }, env: FIXED_ENV });
    expect(() => runCode(VALIDATE, ctx)).not.toThrow();
  });

  test('accepts payload with only description', () => {
    const ctx = makeN8nContext({ inputItem: { description: 'some context' }, env: FIXED_ENV });
    expect(() => runCode(VALIDATE, ctx)).not.toThrow();
  });

  test('unwraps body property when present', () => {
    const ctx = makeN8nContext({
      inputItem: { body: { file_path: 'src/foo.py', language: 'python' } },
      env: FIXED_ENV,
    });
    const result = runCode(VALIDATE, ctx);
    expect(result[0].json.language).toBe('python');
  });

  test('uses top-level json when body property absent', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'src/foo.py', language: 'go' }, env: FIXED_ENV });
    expect(runCode(VALIDATE, ctx)[0].json.language).toBe('go');
  });

  test('defaults language to "unknown" when absent', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'foo.py' }, env: FIXED_ENV });
    expect(runCode(VALIDATE, ctx)[0].json.language).toBe('unknown');
  });

  test('defaults changed_code to empty string when absent', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'foo.py' }, env: FIXED_ENV });
    expect(runCode(VALIDATE, ctx)[0].json.changed_code).toBe('');
  });

  test('today equals the fixed date', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'foo.py' }, env: FIXED_ENV });
    expect(runCode(VALIDATE, ctx)[0].json.today).toBe(FIXED_DATE);
  });

  test('includes vault_path, ollama_url, ollama_model from env', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'foo.py' }, env: FIXED_ENV });
    const json = runCode(VALIDATE, ctx)[0].json;
    expect(json.vault_path).toBe('/vault');
    expect(json.ollama_url).toBe('http://ollama:11434');
    expect(json.ollama_model).toBe('deepseek-r1:7b');
  });

  test('sanitises file_path into safe_title', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'src/auth/jwt.py' }, env: FIXED_ENV });
    const title = runCode(VALIDATE, ctx)[0].json.safe_title;
    expect(title).not.toContain('/');
    expect(title).not.toMatch(/^_|_$/);
  });

  test('returns exactly one item', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'foo.py' }, env: FIXED_ENV });
    expect(runCode(VALIDATE, ctx)).toHaveLength(1);
  });
});

// ── Build Linker Context ─────────────────────────────────────────────────────

describe('Orchestrator – Build Linker Context', () => {
  const sharedCtx = {
    file_path: 'src/foo.py', language: 'python', description: 'caching',
    today: FIXED_DATE, safe_title: 'src_foo.py', vault_path: '/vault',
    ollama_url: 'http://ollama:11434', ollama_model: 'deepseek-r1:7b',
  };

  function run(items) {
    const ctx = makeN8nContext({
      inputItem: items[0]?.json ?? {},
      allItems:  items,
      nodeOutputs: { 'Validate & Normalise Input': sharedCtx },
      env: FIXED_ENV,
    });
    return runCode(BUILD_LINKER_CTX, ctx);
  }

  // BUILD_LINKER_CTX is needed for these tests — define it here to avoid shadowing.
  const BUILD_LINKER_CTX = BUILD_LINKER;

  test('builds new_notes from items with note_path', () => {
    const items = [
      { json: { note_path: '/vault/code/a.md', title: 'A', agent: 'documenter' } },
      { json: { note_path: '/vault/research/b.md', title: 'B', agent: 'researcher' } },
    ];
    const result = run(items);
    expect(result[0].json.new_notes).toHaveLength(2);
  });

  test('filters out items without note_path', () => {
    const items = [
      { json: { note_path: '/vault/code/a.md', title: 'A', agent: 'documenter' } },
      { json: { title: 'No path here' } },
    ];
    const result = run(items);
    expect(result[0].json.new_notes).toHaveLength(1);
  });

  test('maps items to {path, title, type} shape', () => {
    const items = [{ json: { note_path: '/vault/code/a.md', title: 'A', agent: 'documenter' } }];
    const note = run(items)[0].json.new_notes[0];
    expect(note).toEqual({ path: '/vault/code/a.md', title: 'A', type: 'documenter' });
  });

  test('defaults type to "unknown" when agent field absent', () => {
    const items = [{ json: { note_path: '/a.md' } }];
    expect(run(items)[0].json.new_notes[0].type).toBe('unknown');
  });

  test('returns empty new_notes when no items have note_path', () => {
    const items = [{ json: { foo: 'bar' } }, { json: { baz: 1 } }];
    expect(run(items)[0].json.new_notes).toHaveLength(0);
  });

  test('spreads shared context fields into output', () => {
    const items = [{ json: { note_path: '/a.md', title: 'A', agent: 'documenter' } }];
    const json = run(items)[0].json;
    expect(json.language).toBe('python');
    expect(json.vault_path).toBe('/vault');
  });
});
