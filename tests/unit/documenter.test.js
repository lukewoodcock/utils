'use strict';

const path = require('path');
const { makeN8nContext, runCode } = require('./helpers/n8n-mock');

const workflow = require('../../workflows/01_documenter_agent.json');

function getCode(nodeName) {
  const node = workflow.nodes.find(n => n.name === nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found in workflow`);
  return node.parameters.jsCode;
}

const PREPARE_CONTEXT = getCode('Prepare Context');
const BUILD_FILE_PATH = getCode('Build File Path');

const FIXED_DATE = '2025-04-21';
const FIXED_ENV  = {
  VAULT_PATH:   '/vault',
  OLLAMA_URL:   'http://ollama:11434',
  OLLAMA_MODEL: 'deepseek-r1:7b',
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${FIXED_DATE}T12:00:00Z`));
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Prepare Context ─────────────────────────────────────────────────────────

describe('Documenter – Prepare Context', () => {
  test('returns exactly one item', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'src/foo.py' }, env: FIXED_ENV });
    const result = runCode(PREPARE_CONTEXT, ctx);
    expect(result).toHaveLength(1);
  });

  test('passes file_path through to output', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'src/auth/jwt.py' }, env: FIXED_ENV });
    const result = runCode(PREPARE_CONTEXT, ctx);
    expect(result[0].json.file_path).toBe('src/auth/jwt.py');
  });

  test('defaults language to "unknown" when absent', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'foo.js' }, env: FIXED_ENV });
    const result = runCode(PREPARE_CONTEXT, ctx);
    expect(result[0].json.language).toBe('unknown');
  });

  test('defaults file_path to "unknown" when absent', () => {
    const ctx = makeN8nContext({ inputItem: {}, env: FIXED_ENV });
    const result = runCode(PREPARE_CONTEXT, ctx);
    expect(result[0].json.file_path).toBe('unknown');
  });

  test('sanitises slashes in file_path into underscores for safe_title', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'src/auth/jwt.py' }, env: FIXED_ENV });
    const result = runCode(PREPARE_CONTEXT, ctx);
    expect(result[0].json.safe_title).not.toContain('/');
    expect(result[0].json.safe_title).toMatch(/^[a-zA-Z0-9_\-.]+$/);
  });

  test('strips leading and trailing underscores from safe_title', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: '/leading/trailing/' }, env: FIXED_ENV });
    const result = runCode(PREPARE_CONTEXT, ctx);
    const title = result[0].json.safe_title;
    expect(title).not.toMatch(/^_/);
    expect(title).not.toMatch(/_$/);
  });

  test('today is in YYYY-MM-DD format', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'foo.py' }, env: FIXED_ENV });
    const result = runCode(PREPARE_CONTEXT, ctx);
    expect(result[0].json.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result[0].json.today).toBe(FIXED_DATE);
  });

  test('uses VAULT_PATH env var', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'f.py' }, env: FIXED_ENV });
    expect(runCode(PREPARE_CONTEXT, ctx)[0].json.vault_path).toBe('/vault');
  });

  test('falls back to default vault_path when env var absent', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'f.py' }, env: {} });
    expect(runCode(PREPARE_CONTEXT, ctx)[0].json.vault_path).toBe('/vault');
  });

  test('uses provided OLLAMA_URL and OLLAMA_MODEL env vars', () => {
    const env = { VAULT_PATH: '/v', OLLAMA_URL: 'http://mock:8080', OLLAMA_MODEL: 'llama3:8b' };
    const ctx = makeN8nContext({ inputItem: { file_path: 'f.py' }, env });
    const json = runCode(PREPARE_CONTEXT, ctx)[0].json;
    expect(json.ollama_url).toBe('http://mock:8080');
    expect(json.ollama_model).toBe('llama3:8b');
  });

  test('falls back to default ollama defaults when env absent', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'f.py' }, env: {} });
    const json = runCode(PREPARE_CONTEXT, ctx)[0].json;
    expect(json.ollama_url).toBe('http://ollama:11434');
    expect(json.ollama_model).toBe('deepseek-r1:7b');
  });
});

// ── Build File Path ──────────────────────────────────────────────────────────

describe('Documenter – Build File Path', () => {
  const prevCtx = {
    vault_path:   '/vault',
    today:        FIXED_DATE,
    safe_title:   'src_auth_jwt.py',
    language:     'python',
    file_path:    'src/auth/jwt.py',
    description:  '',
    changed_code: '',
    ollama_url:   'http://ollama:11434',
    ollama_model: 'deepseek-r1:7b',
  };

  function run(llmResponse) {
    const ctx = makeN8nContext({
      inputItem:   llmResponse,
      nodeOutputs: { 'Prepare Context': prevCtx },
      env: FIXED_ENV,
    });
    return runCode(BUILD_FILE_PATH, ctx);
  }

  test('note_dir is vault_path/code', () => {
    const result = run({ message: { content: '# doc' } });
    expect(result[0].json.note_dir).toBe('/vault/code');
  });

  test('file_name combines today and safe_title', () => {
    const result = run({ message: { content: '# doc' } });
    expect(result[0].json.file_name).toBe(`${FIXED_DATE}_src_auth_jwt.py.md`);
  });

  test('full_path joins note_dir and file_name', () => {
    const result = run({ message: { content: '# doc' } });
    expect(result[0].json.full_path).toBe(`/vault/code/${FIXED_DATE}_src_auth_jwt.py.md`);
  });

  test('extracts content from message.content (Ollama format)', () => {
    const result = run({ message: { content: '# Hello' } });
    expect(result[0].json.note_content).toBe('# Hello');
  });

  test('extracts content from choices[0].message.content (OpenAI format)', () => {
    const result = run({ choices: [{ message: { content: '# Hello OAI' } }] });
    expect(result[0].json.note_content).toBe('# Hello OAI');
  });

  test('falls back to empty string when LLM response has no content', () => {
    const result = run({});
    expect(result[0].json.note_content).toBe('');
  });

  test('spreads all Prepare Context fields into output', () => {
    const result = run({ message: { content: '# doc' } });
    expect(result[0].json.language).toBe('python');
    expect(result[0].json.file_path).toBe('src/auth/jwt.py');
  });
});
