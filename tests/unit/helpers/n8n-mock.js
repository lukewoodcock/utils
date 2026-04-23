'use strict';

/**
 * Creates a minimal n8n execution context so Code node JS strings can be run
 * with `runCode()` in unit tests without a real n8n instance.
 *
 * @param {object} opts
 * @param {object}   opts.inputItem    - the value of $input.item.json
 * @param {object[]} opts.allItems     - array of {json: ...} for $input.all()
 * @param {object}   opts.nodeOutputs  - map of nodeName → object for $('NodeName').item.json
 * @param {object}   opts.env          - map of variable name → value for $env.VAR
 */
function makeN8nContext({ inputItem = {}, allItems = null, nodeOutputs = {}, env = {} } = {}) {
  const $input = {
    item: { json: inputItem },
    all:  () => allItems !== null ? allItems : [{ json: inputItem }],
  };

  const $ = (nodeName) => ({
    item: { json: nodeOutputs[nodeName] !== undefined ? nodeOutputs[nodeName] : {} },
    all:  () => {
      const out = nodeOutputs[nodeName];
      if (Array.isArray(out)) return out;
      if (out !== undefined) return [{ json: out }];
      return [];
    },
  });

  // Proxy so $env.MISSING_VAR returns undefined (same as n8n behaviour).
  const $env = new Proxy(env, {
    get: (target, key) => target[key],
  });

  return { $input, $, $env };
}

/**
 * Executes a Code node JS string in an isolated function scope with mocked
 * n8n globals and returns the result array.
 *
 * @param {string} jsCode   - raw JS from node.parameters.jsCode
 * @param {object} context  - result of makeN8nContext()
 * @returns {Array}         - the array returned by the code node
 */
function runCode(jsCode, context) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$', '$env', jsCode);
  return fn(context.$input, context.$, context.$env);
}

module.exports = { makeN8nContext, runCode };
