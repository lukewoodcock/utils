'use strict';

const path = require('path');

const WORKFLOW_DIR = path.resolve(__dirname, '../../workflows');

const FILES = {
  documenter:   '01_documenter_agent.json',
  researcher:   '02_researcher_agent.json',
  linker:       '03_linker_agent.json',
  orchestrator: '04_orchestrator.json',
};

function load(key) {
  return require(path.join(WORKFLOW_DIR, FILES[key]));
}

function allJsCode(wf) {
  return wf.nodes
    .filter(n => n.type === 'n8n-nodes-base.code')
    .map(n => n.parameters.jsCode || '')
    .join('\n');
}

function nodeNames(wf) {
  return new Set(wf.nodes.map(n => n.name));
}

function allConnectionTargets(wf) {
  const targets = new Set();
  for (const branches of Object.values(wf.connections)) {
    for (const branch of branches.main || []) {
      for (const target of branch) {
        targets.add(target.node);
      }
    }
  }
  return targets;
}

// ── All files load as valid JSON ─────────────────────────────────────────────

describe('Workflow files – parseable JSON', () => {
  test.each(Object.entries(FILES))('%s workflow loads without error', (key) => {
    expect(() => load(key)).not.toThrow();
  });

  test.each(Object.entries(FILES))('%s workflow has a name field', (key) => {
    expect(typeof load(key).name).toBe('string');
    expect(load(key).name.length).toBeGreaterThan(0);
  });
});

// ── Trigger type: sub-agents must use webhook, not start ─────────────────────

describe('Workflow trigger types', () => {
  test('Documenter has no start node (trigger bug fix)', () => {
    const wf = load('documenter');
    const startNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.start');
    expect(startNodes).toHaveLength(0);
  });

  test('Documenter has at least one webhook trigger node', () => {
    const wf = load('documenter');
    const webhooks = wf.nodes.filter(n => n.type === 'n8n-nodes-base.webhook');
    expect(webhooks.length).toBeGreaterThanOrEqual(1);
  });

  test('Researcher has no start node (trigger bug fix)', () => {
    const wf = load('researcher');
    expect(wf.nodes.filter(n => n.type === 'n8n-nodes-base.start')).toHaveLength(0);
  });

  test('Researcher has at least one webhook trigger node', () => {
    expect(load('researcher').nodes.filter(n => n.type === 'n8n-nodes-base.webhook').length).toBeGreaterThanOrEqual(1);
  });

  test('Linker has no start node (trigger bug fix)', () => {
    expect(load('linker').nodes.filter(n => n.type === 'n8n-nodes-base.start')).toHaveLength(0);
  });

  test('Linker has at least one webhook trigger node', () => {
    expect(load('linker').nodes.filter(n => n.type === 'n8n-nodes-base.webhook').length).toBeGreaterThanOrEqual(1);
  });

  test('Orchestrator uses webhook trigger', () => {
    expect(load('orchestrator').nodes.filter(n => n.type === 'n8n-nodes-base.webhook').length).toBeGreaterThanOrEqual(1);
  });
});

// ── Webhook path validation ───────────────────────────────────────────────────

describe('Webhook paths', () => {
  function webhookPath(wf) {
    const node = wf.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
    return node?.parameters?.path;
  }

  test('Documenter webhook path is "documenter/trigger"', () => {
    expect(webhookPath(load('documenter'))).toBe('documenter/trigger');
  });

  test('Researcher webhook path is "researcher/trigger"', () => {
    expect(webhookPath(load('researcher'))).toBe('researcher/trigger');
  });

  test('Linker webhook path is "linker/trigger"', () => {
    expect(webhookPath(load('linker'))).toBe('linker/trigger');
  });

  test('Orchestrator webhook path is "knowledge-graph/trigger"', () => {
    expect(webhookPath(load('orchestrator'))).toBe('knowledge-graph/trigger');
  });
});

// ── Code nodes have jsCode ───────────────────────────────────────────────────

describe('Code node integrity', () => {
  test.each(Object.entries(FILES))('%s: all code nodes have non-empty jsCode', (key) => {
    const wf = load(key);
    const codeNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.code');
    expect(codeNodes.length).toBeGreaterThan(0);
    for (const node of codeNodes) {
      expect(typeof node.parameters.jsCode).toBe('string');
      expect(node.parameters.jsCode.trim().length).toBeGreaterThan(0);
    }
  });

  test.each(Object.entries(FILES))('%s: all HTTP request nodes have a url parameter', (key) => {
    const wf = load(key);
    const httpNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest');
    for (const node of httpNodes) {
      expect(typeof node.parameters.url).toBe('string');
      expect(node.parameters.url.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── Connection integrity ─────────────────────────────────────────────────────

describe('Connection integrity', () => {
  test.each(Object.entries(FILES))('%s: every connection target exists as a node', (key) => {
    const wf = load(key);
    const names   = nodeNames(wf);
    const targets = allConnectionTargets(wf);
    for (const t of targets) {
      expect(names.has(t)).toBe(true);
    }
  });

  test.each(Object.entries(FILES))('%s: every non-trigger node is reachable as a connection target', (key) => {
    const wf      = load(key);
    const targets = allConnectionTargets(wf);
    const triggerTypes = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.start']);
    const nonTrigger = wf.nodes.filter(n => !triggerTypes.has(n.type));
    for (const node of nonTrigger) {
      expect(targets.has(node.name)).toBe(true);
    }
  });
});

// ── Environment variable references ──────────────────────────────────────────

describe('Environment variable references in Code nodes', () => {
  test.each(['documenter', 'researcher', 'linker'])('%s references VAULT_PATH, OLLAMA_URL, OLLAMA_MODEL', (key) => {
    const code = allJsCode(load(key));
    expect(code).toContain('VAULT_PATH');
    expect(code).toContain('OLLAMA_URL');
    expect(code).toContain('OLLAMA_MODEL');
  });
});

// ── Orchestrator fan-out structure ───────────────────────────────────────────

describe('Orchestrator fan-out and merge structure', () => {
  test('Fan-Out Context node has exactly 2 output branches', () => {
    const wf = load('orchestrator');
    const fanOut = wf.connections['Fan-Out Context'];
    expect(fanOut).toBeDefined();
    expect(fanOut.main).toHaveLength(2);
  });

  test('Fan-Out Context branches target Documenter and Researcher call nodes', () => {
    const wf = load('orchestrator');
    const targets = wf.connections['Fan-Out Context'].main.map(branch => branch[0].node);
    expect(targets).toContain('Call Documenter Agent');
    expect(targets).toContain('Call Researcher Agent');
  });

  test('Call Documenter Agent targets Merge Branch Results at index 0', () => {
    const wf     = load('orchestrator');
    const target = wf.connections['Call Documenter Agent'].main[0][0];
    expect(target.node).toBe('Merge Branch Results');
    expect(target.index).toBe(0);
  });

  test('Call Researcher Agent targets Merge Branch Results at index 1', () => {
    const wf     = load('orchestrator');
    const target = wf.connections['Call Researcher Agent'].main[0][0];
    expect(target.node).toBe('Merge Branch Results');
    expect(target.index).toBe(1);
  });
});
