'use strict';

const { makeN8nContext, runCode } = require('./helpers/n8n-mock');

const workflow = require('../../workflows/02_researcher_agent.json');

function getCode(nodeName) {
  const node = workflow.nodes.find(n => n.name === nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found in workflow`);
  return node.parameters.jsCode;
}

const PREPARE_CONTEXT = getCode('Prepare Context');
const BUILD_FILE_PATH = getCode('Build File Path');

const FIXED_DATE = '2025-04-21';
const FIXED_ENV  = { VAULT_PATH: '/vault', OLLAMA_URL: 'http://ollama:11434', OLLAMA_MODEL: 'deepseek-r1:7b' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${FIXED_DATE}T12:00:00Z`));
});
afterEach(() => { jest.useRealTimers(); });

// ── Prepare Context ──────────────────────────────────────────────────────────

describe('Researcher – Prepare Context', () => {
  test('returns exactly one item', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'src/foo.py' }, env: FIXED_ENV });
    expect(runCode(PREPARE_CONTEXT, ctx)).toHaveLength(1);
  });

  test('prefers description over file_path for safe_title derivation', () => {
    const ctx = makeN8nContext({
      inputItem: { file_path: 'src/foo.py', description: 'JWT token refresh logic' },
      env: FIXED_ENV,
    });
    const title = runCode(PREPARE_CONTEXT, ctx)[0].json.safe_title;
    // derived from description, not file_path — should not contain "foo"
    expect(title).toContain('JWT');
    expect(title).not.toContain('foo');
  });

  test('falls back to file_path when description is empty', () => {
    const ctx = makeN8nContext({
      inputItem: { file_path: 'src/bar.py', description: '' },
      env: FIXED_ENV,
    });
    const title = runCode(PREPARE_CONTEXT, ctx)[0].json.safe_title;
    expect(title).toContain('bar');
  });

  test('truncates safe_title to 60 characters', () => {
    const ctx = makeN8nContext({
      inputItem: { description: 'a'.repeat(100) },
      env: FIXED_ENV,
    });
    const title = runCode(PREPARE_CONTEXT, ctx)[0].json.safe_title;
    expect(title.length).toBeLessThanOrEqual(60);
  });

  test('sanitises special characters in description', () => {
    const ctx = makeN8nContext({
      inputItem: { description: 'JWT/OAuth 2.0 refresh tokens!' },
      env: FIXED_ENV,
    });
    const title = runCode(PREPARE_CONTEXT, ctx)[0].json.safe_title;
    expect(title).not.toMatch(/[/! ]/);
  });

  test('today is in YYYY-MM-DD format and equals fixed date', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'f.py' }, env: FIXED_ENV });
    expect(runCode(PREPARE_CONTEXT, ctx)[0].json.today).toBe(FIXED_DATE);
  });

  test('applies env vars for vault_path and ollama settings', () => {
    const env = { VAULT_PATH: '/custom', OLLAMA_URL: 'http://mock:9000', OLLAMA_MODEL: 'qwen3:8b' };
    const ctx = makeN8nContext({ inputItem: { file_path: 'f.py' }, env });
    const json = runCode(PREPARE_CONTEXT, ctx)[0].json;
    expect(json.vault_path).toBe('/custom');
    expect(json.ollama_url).toBe('http://mock:9000');
    expect(json.ollama_model).toBe('qwen3:8b');
  });

  test('falls back to defaults when env vars absent', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'f.py' }, env: {} });
    const json = runCode(PREPARE_CONTEXT, ctx)[0].json;
    expect(json.vault_path).toBe('/vault');
    expect(json.ollama_url).toBe('http://ollama:11434');
    expect(json.ollama_model).toBe('deepseek-r1:7b');
  });

  test('output does not include changed_code field', () => {
    const ctx = makeN8nContext({ inputItem: { file_path: 'f.py', changed_code: 'x' }, env: FIXED_ENV });
    const json = runCode(PREPARE_CONTEXT, ctx)[0].json;
    expect(json.changed_code).toBeUndefined();
  });
});

// ── Build File Path ──────────────────────────────────────────────────────────

describe('Researcher – Build File Path', () => {
  const prevCtx = {
    vault_path: '/vault', today: FIXED_DATE, safe_title: 'JWT_token_refresh_logic',
    language: 'python', file_path: 'src/auth/jwt.py', description: 'JWT token refresh logic',
    ollama_url: 'http://ollama:11434', ollama_model: 'deepseek-r1:7b',
  };

  function run(llmResponse) {
    const ctx = makeN8nContext({
      inputItem:   llmResponse,
      nodeOutputs: { 'Prepare Context': prevCtx },
      env: FIXED_ENV,
    });
    return runCode(BUILD_FILE_PATH, ctx);
  }

  test('note_dir is vault_path/research', () => {
    expect(run({ message: { content: '# doc' } })[0].json.note_dir).toBe('/vault/research');
  });

  test('file_name includes "research_" prefix', () => {
    const name = run({ message: { content: '# doc' } })[0].json.file_name;
    expect(name).toBe(`${FIXED_DATE}_research_JWT_token_refresh_logic.md`);
  });

  test('full_path combines note_dir and file_name', () => {
    const full = run({ message: { content: '# doc' } })[0].json.full_path;
    expect(full).toBe(`/vault/research/${FIXED_DATE}_research_JWT_token_refresh_logic.md`);
  });

  test('extracts content from message.content', () => {
    expect(run({ message: { content: '# Research' } })[0].json.note_content).toBe('# Research');
  });

  test('falls back to choices[0].message.content', () => {
    expect(run({ choices: [{ message: { content: '# OAI' } }] })[0].json.note_content).toBe('# OAI');
  });

  test('falls back to empty string when LLM response has no content', () => {
    expect(run({})[0].json.note_content).toBe('');
  });
});
