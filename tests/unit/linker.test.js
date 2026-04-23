'use strict';

const { makeN8nContext, runCode } = require('./helpers/n8n-mock');

const workflow = require('../../workflows/03_linker_agent.json');

function getCode(nodeName) {
  const node = workflow.nodes.find(n => n.name === nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found in workflow`);
  return node.parameters.jsCode;
}

const PREPARE_CONTEXT = getCode('Prepare Context');
const BUILD_NOTE_INDEX = getCode('Build Note Index');
const PARSE_LINK_MAP   = getCode('Parse Link Map');
const APPEND_LINKS     = getCode('Append Links');
const SKIP_IF_NO_LINKS = getCode('Skip If No Links');

const FIXED_DATE = '2025-04-21';
const FIXED_ENV  = { VAULT_PATH: '/vault', OLLAMA_URL: 'http://ollama:11434', OLLAMA_MODEL: 'deepseek-r1:7b' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${FIXED_DATE}T12:00:00Z`));
});
afterEach(() => { jest.useRealTimers(); });

// ── Prepare Context ──────────────────────────────────────────────────────────

describe('Linker – Prepare Context', () => {
  test('passes through new_notes array from input', () => {
    const notes = [{ path: '/vault/code/note.md', title: 'Note', type: 'code' }];
    const ctx = makeN8nContext({ inputItem: { new_notes: notes }, env: FIXED_ENV });
    expect(runCode(PREPARE_CONTEXT, ctx)[0].json.new_notes).toEqual(notes);
  });

  test('defaults new_notes to empty array when absent', () => {
    const ctx = makeN8nContext({ inputItem: {}, env: FIXED_ENV });
    expect(runCode(PREPARE_CONTEXT, ctx)[0].json.new_notes).toEqual([]);
  });

  test('sets today in YYYY-MM-DD format', () => {
    const ctx = makeN8nContext({ inputItem: {}, env: FIXED_ENV });
    expect(runCode(PREPARE_CONTEXT, ctx)[0].json.today).toBe(FIXED_DATE);
  });

  test('applies env vars for vault_path, ollama_url, ollama_model', () => {
    const env = { VAULT_PATH: '/v', OLLAMA_URL: 'http://x:9', OLLAMA_MODEL: 'qwen3:8b' };
    const ctx = makeN8nContext({ inputItem: {}, env });
    const json = runCode(PREPARE_CONTEXT, ctx)[0].json;
    expect(json.vault_path).toBe('/v');
    expect(json.ollama_url).toBe('http://x:9');
    expect(json.ollama_model).toBe('qwen3:8b');
  });
});

// ── Build Note Index ─────────────────────────────────────────────────────────

describe('Linker – Build Note Index', () => {
  function run(files, vaultPath = '/vault') {
    const allItems = files.map(f => ({ json: f }));
    const ctx = makeN8nContext({
      inputItem:   allItems[0]?.json ?? {},
      allItems,
      nodeOutputs: { 'Prepare Context': { vault_path: vaultPath } },
      env: FIXED_ENV,
    });
    return runCode(BUILD_NOTE_INDEX, ctx);
  }

  test('filters out non-.md files', () => {
    const files = [
      { fileName: '/vault/code/note.md' },
      { fileName: '/vault/code/image.png' },
      { fileName: '/vault/research/doc.md' },
    ];
    const result = run(files);
    expect(result[0].json.existing_notes).toHaveLength(2);
    expect(result[0].json.existing_notes.every(f => f.endsWith('.md'))).toBe(true);
  });

  test('strips vault_path prefix from file paths', () => {
    const files = [{ fileName: '/vault/code/2025-04-21_note.md' }];
    const result = run(files);
    expect(result[0].json.existing_notes[0]).toBe('code/2025-04-21_note.md');
  });

  test('builds index_string in wikilink format', () => {
    const files = [{ fileName: '/vault/code/2025-04-21_note.md' }];
    const result = run(files);
    expect(result[0].json.index_string).toBe('- [[2025-04-21_note]] (code/2025-04-21_note.md)');
  });

  test('handles files with "name" property instead of "fileName"', () => {
    const files = [{ name: '/vault/research/doc.md' }];
    const result = run(files);
    expect(result[0].json.existing_notes[0]).toBe('research/doc.md');
  });

  test('handles files with "path" property', () => {
    const files = [{ path: '/vault/logs/log.md' }];
    const result = run(files);
    expect(result[0].json.existing_notes[0]).toBe('logs/log.md');
  });

  test('returns empty existing_notes and empty index_string for empty file list', () => {
    const result = run([]);
    expect(result[0].json.existing_notes).toEqual([]);
    expect(result[0].json.index_string).toBe('');
  });
});

// ── Parse Link Map ───────────────────────────────────────────────────────────

describe('Linker – Parse Link Map', () => {
  function run(llmResponse) {
    const ctx = makeN8nContext({ inputItem: llmResponse, env: FIXED_ENV });
    return runCode(PARSE_LINK_MAP, ctx);
  }

  const VALID_PAYLOAD = [
    { new_note_path: '/vault/code/a.md', links_to_add: ['[[b]]', '[[c]]'] },
    { new_note_path: '/vault/research/b.md', links_to_add: [] },
  ];

  test('parses clean JSON array from message.content', () => {
    const result = run({ message: { content: JSON.stringify(VALID_PAYLOAD) } });
    expect(result).toHaveLength(2);
    expect(result[0].json.new_note_path).toBe('/vault/code/a.md');
    expect(result[0].json.links_to_add).toEqual(['[[b]]', '[[c]]']);
  });

  test('strips ```json fences before parsing', () => {
    const fenced = '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```';
    const result = run({ message: { content: fenced } });
    expect(result).toHaveLength(2);
  });

  test('strips plain ``` fences before parsing', () => {
    const fenced = '```\n' + JSON.stringify(VALID_PAYLOAD) + '\n```';
    const result = run({ message: { content: fenced } });
    expect(result).toHaveLength(2);
  });

  test('returns empty array on JSON parse failure (no crash)', () => {
    const result = run({ message: { content: 'this is not json at all' } });
    expect(result).toEqual([]);
  });

  test('defaults links_to_add to [] when absent from entry', () => {
    const payload = JSON.stringify([{ new_note_path: '/a.md' }]);
    const result = run({ message: { content: payload } });
    expect(result[0].json.links_to_add).toEqual([]);
  });

  test('returns one item per link-map entry (fan-out)', () => {
    const payload = JSON.stringify([
      { new_note_path: '/a.md', links_to_add: [] },
      { new_note_path: '/b.md', links_to_add: [] },
      { new_note_path: '/c.md', links_to_add: [] },
    ]);
    expect(run({ message: { content: payload } })).toHaveLength(3);
  });

  test('falls back to choices[0].message.content format', () => {
    const result = run({ choices: [{ message: { content: JSON.stringify(VALID_PAYLOAD) } }] });
    expect(result).toHaveLength(2);
  });

  test('returns empty array when LLM response has no content', () => {
    expect(run({})).toEqual([]);
  });
});

// ── Append Links ─────────────────────────────────────────────────────────────

describe('Linker – Append Links', () => {
  function run(linkInfo, fileData) {
    const ctx = makeN8nContext({
      inputItem:   { data: fileData },
      nodeOutputs: { 'Parse Link Map': linkInfo },
      env: FIXED_ENV,
    });
    return runCode(APPEND_LINKS, ctx);
  }

  test('appends ## Related Notes section when links_to_add is non-empty', () => {
    const result = run(
      { new_note_path: '/vault/code/a.md', links_to_add: ['[[b]]', '[[c]]'] },
      '# Note\n\nContent.'
    );
    expect(result[0].json.note_content).toContain('## Related Notes');
    expect(result[0].json.note_content).toContain('- [[b]]');
    expect(result[0].json.note_content).toContain('- [[c]]');
    expect(result[0].json.skip).toBe(false);
  });

  test('sets skip=true and preserves original content when links_to_add is empty', () => {
    const original = '# Note\n\nOriginal content.';
    const result = run({ new_note_path: '/vault/code/a.md', links_to_add: [] }, original);
    expect(result[0].json.skip).toBe(true);
    expect(result[0].json.note_content).toBe(original);
  });

  test('sets skip=true when links_to_add is absent (undefined)', () => {
    const result = run({ new_note_path: '/vault/code/a.md' }, '# Note');
    expect(result[0].json.skip).toBe(true);
  });

  test('does not duplicate ## Related Notes if section already present', () => {
    const existing = '# Note\n\n## Related Notes\n- [[x]]\n';
    const result = run(
      { new_note_path: '/vault/code/a.md', links_to_add: ['[[y]]'] },
      existing
    );
    const matches = (result[0].json.note_content.match(/## Related Notes/g) || []).length;
    expect(matches).toBe(1);
  });

  test('preserves original content before the new section', () => {
    const original = '# Note\n\nContent.';
    const result = run(
      { new_note_path: '/vault/code/a.md', links_to_add: ['[[b]]'] },
      original
    );
    expect(result[0].json.note_content).toContain(original);
  });

  test('handles empty file data gracefully', () => {
    const result = run({ new_note_path: '/vault/code/a.md', links_to_add: ['[[b]]'] }, '');
    expect(result[0].json.note_content).toContain('## Related Notes');
  });
});

// ── Skip If No Links ─────────────────────────────────────────────────────────

describe('Linker – Skip If No Links', () => {
  test('returns empty array when skip=true', () => {
    const ctx = makeN8nContext({
      inputItem: { skip: true, note_content: '# Note', new_note_path: '/a.md' },
      env: FIXED_ENV,
    });
    expect(runCode(SKIP_IF_NO_LINKS, ctx)).toEqual([]);
  });

  test('returns the item when skip=false', () => {
    const ctx = makeN8nContext({
      inputItem: { skip: false, note_content: '# Note with links', new_note_path: '/a.md' },
      env: FIXED_ENV,
    });
    const result = runCode(SKIP_IF_NO_LINKS, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].json.note_content).toBe('# Note with links');
  });
});
