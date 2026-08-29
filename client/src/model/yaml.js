// A small, purpose-built YAML reader/writer — not a general YAML-spec
// parser. It only needs to round-trip the shapes model/slimFormat.js
// actually produces: nested block-style mappings and sequences (multi-line,
// indentation-based) whose leaf values are plain scalars or single-line
// flow mappings (`{ key: value, ... }`). That restriction is what keeps
// this under a hundred lines instead of a full spec implementation, while
// still emitting (and accepting) perfectly ordinary, hand-editable YAML —
// anyone opening an exported file in a real editor sees normal YAML, they
// just won't get anchors, multi-doc streams, or block scalars back out of
// this particular reader.

// Marks a mapping that should render as one-line `{ key: value, ... }`
// flow style rather than further block-style nesting — used for small leaf
// records (a single port, a styled wire) where one line reads better than
// three. A plain object is never ambiguous on the *read* side (a flow
// mapping is always `{`-delimited on one line, regardless of which key it
// sits under), so this wrapper only matters when *writing*: the object a
// reader gets back from parseYaml is always a plain object, never wrapped.
export class Flow {
  constructor(value) {
    this.value = value;
  }
}

export function flow(value) {
  return new Flow(value);
}

function needsQuoting(str) {
  if (str === '') return true;
  if (/^\s|\s$/.test(str)) return true;
  if (/^(true|false|null|~)$/i.test(str)) return true;
  if (/^-?\d+(\.\d+)?$/.test(str)) return true;
  // A leading special character is a YAML indicator (sequence/anchor/
  // alias/tag/block-scalar/quote/...) — only ambiguous at the very start
  // of a plain scalar, safe anywhere else in it (so "b1.p1 -> b2.p1"
  // doesn't need quoting just for containing a `>`).
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(str)) return true;
  // `: ` (or a trailing `:`) reads as a mapping key, ` #` starts a
  // comment, and `[`, `]`, `{`, `}`, `,` are flow-mapping/-sequence
  // delimiters this codec's own flow parser splits on — all ambiguous
  // wherever they appear, not just at the start.
  if (/:(\s|$)/.test(str)) return true;
  if (/\s#/.test(str)) return true;
  if (/[[\]{},]/.test(str)) return true;
  return false;
}

function quote(str) {
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function scalarToText(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const str = String(value);
  return needsQuoting(str) ? quote(str) : str;
}

// A flow mapping's own values are the same scalars, just comma-joined on
// one line — used for small leaf records (a single port, a styled wire)
// where one line reads better than three.
function flowMappingToText(obj) {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${scalarToText(v)}`);
  return `{ ${parts.join(', ')} }`;
}

export function stringifyYaml(value) {
  const lines = [];

  function writeMapping(obj, indent) {
    const pad = ' '.repeat(indent);
    for (const [key, val] of Object.entries(obj)) {
      if (val === undefined) continue;
      if (val instanceof Flow) {
        lines.push(`${pad}${key}: ${flowMappingToText(val.value)}`);
      } else if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${pad}${key}: []`);
        } else {
          lines.push(`${pad}${key}:`);
          writeSequence(val, indent + 2);
        }
      } else if (val !== null && typeof val === 'object') {
        if (Object.keys(val).length === 0) {
          lines.push(`${pad}${key}: {}`);
        } else {
          lines.push(`${pad}${key}:`);
          writeMapping(val, indent + 2);
        }
      } else {
        lines.push(`${pad}${key}: ${scalarToText(val)}`);
      }
    }
  }

  function writeSequence(arr, indent) {
    const pad = ' '.repeat(indent);
    for (const item of arr) {
      const flowValue = item instanceof Flow ? item.value : item;
      if (flowValue !== null && typeof flowValue === 'object') {
        lines.push(`${pad}- ${flowMappingToText(flowValue)}`);
      } else {
        lines.push(`${pad}- ${scalarToText(flowValue)}`);
      }
    }
  }

  writeMapping(value, 0);
  return lines.join('\n') + '\n';
}

function parseScalar(text) {
  const t = text.trim();
  if (t === '' || t === '~' || /^null$/i.test(t)) return null;
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^"(.*)"$/.test(t)) return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (/^'(.*)'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  return t;
}

// Splits a flow mapping's insides on top-level commas — the only nesting
// this schema ever puts inside a flow mapping is a quoted string, so
// respecting quotes is the one thing that actually needs tracking here.
function splitFlowEntries(inner) {
  const parts = [];
  let depth = 0;
  let inQuote = null;
  let current = '';
  for (const ch of inner) {
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
      current += ch;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

function parseFlowMapping(text) {
  const inner = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  const obj = {};
  for (const part of splitFlowEntries(inner)) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim();
    obj[key] = parseScalar(part.slice(colon + 1));
  }
  return obj;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

export function parseYaml(text) {
  const lines = text
    .split('\n')
    .map((line) => {
      // A `#` inside a quoted string is never a comment — but this
      // schema's scalars never contain one in practice, so a simple
      // unquoted-# strip (skipping past any quoted span first) is enough.
      let inQuote = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (inQuote) {
          if (ch === inQuote) inQuote = null;
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === '#') {
          line = line.slice(0, i);
          break;
        }
      }
      return line.replace(/\s+$/, '');
    })
    .filter((line) => line.trim() !== '');

  let pos = 0;

  function parseBlock(indent) {
    if (pos >= lines.length || indentOf(lines[pos]) < indent) return {};
    const first = lines[pos].trim();
    return first.startsWith('- ') || first === '-' ? parseSequence(indent) : parseMapping(indent);
  }

  function parseMapping(indent) {
    const obj = {};
    while (pos < lines.length && indentOf(lines[pos]) === indent) {
      const line = lines[pos].trim();
      const colon = line.indexOf(':');
      if (colon === -1) {
        pos += 1;
        continue;
      }
      const key = line.slice(0, colon).trim();
      const rest = line.slice(colon + 1).trim();
      pos += 1;
      if (rest === '') {
        obj[key] = parseBlock(indent + 2);
      } else if (rest === '{}') {
        obj[key] = {};
      } else if (rest === '[]') {
        obj[key] = [];
      } else if (rest.startsWith('{')) {
        obj[key] = parseFlowMapping(rest);
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseSequence(indent) {
    const arr = [];
    while (pos < lines.length && indentOf(lines[pos]) === indent) {
      const line = lines[pos].trim();
      if (!line.startsWith('-')) break;
      const rest = line.slice(1).trim();
      pos += 1;
      if (rest === '') {
        arr.push(parseBlock(indent + 2));
      } else if (rest.startsWith('{')) {
        arr.push(parseFlowMapping(rest));
      } else {
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  return parseMapping(0);
}
