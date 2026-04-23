'use strict';

const TODAY = new Date().toISOString().split('T')[0];

// Valid Ollama-format response for the Documenter agent.
const DOCUMENTER = {
  model: 'deepseek-r1:7b',
  message: {
    role: 'assistant',
    content: [
      '---',
      'title: "JWT Token Refresh Implementation"',
      `date: ${TODAY}`,
      'tags: [python, jwt, authentication]',
      'related: []',
      'source: "ide-webhook"',
      'type: "code"',
      '---',
      '',
      '## Summary',
      'Implements a JWT token refresh mechanism with sliding expiry.',
      '',
      '## Key Points',
      '- Uses HS256 signing algorithm',
      '- Sliding 3600-second expiry window',
      '',
      '## Notes',
      'Ensure secrets are stored securely.',
    ].join('\n'),
  },
  done: true,
};

// Valid Ollama-format response for the Researcher agent.
const RESEARCHER = {
  model: 'deepseek-r1:7b',
  message: {
    role: 'assistant',
    content: [
      '---',
      'title: "Research: JWT Token Refresh"',
      `date: ${TODAY}`,
      'tags: [research, python, best-practices]',
      'related: []',
      'source: "ollama-research"',
      'type: "research"',
      '---',
      '',
      '## Overview',
      'JWT tokens are widely used for stateless authentication.',
      '',
      '## Best Practices',
      '- Keep token lifetimes short',
      '- Rotate signing keys regularly',
      '',
      '## Common Pitfalls',
      '- Storing tokens in localStorage',
      '',
      '## Recommended Libraries / Tools',
      '| Name | Purpose | Notes |',
      '|------|---------|-------|',
      '| PyJWT | JWT encoding | Well-maintained |',
      '',
      '## Further Reading',
      '- RFC 7519 – JSON Web Token',
    ].join('\n'),
  },
  done: true,
};

// Valid Ollama-format response for the Linker agent (JSON array of link suggestions).
const LINKER_WITH_LINKS = {
  model: 'deepseek-r1:7b',
  message: {
    role: 'assistant',
    // Will be rendered with actual paths at runtime by the integration script.
    content: '__LINKER_PLACEHOLDER__',
  },
  done: true,
};

// Linker response when there are no meaningful links.
const LINKER_EMPTY = {
  model: 'deepseek-r1:7b',
  message: { role: 'assistant', content: '[]' },
  done: true,
};

// Linker response wrapped in markdown fences (tests fence-stripping).
const LINKER_FENCED = {
  model: 'deepseek-r1:7b',
  message: { role: 'assistant', content: '```json\n[]\n```' },
  done: true,
};

module.exports = { DOCUMENTER, RESEARCHER, LINKER_WITH_LINKS, LINKER_EMPTY, LINKER_FENCED };
