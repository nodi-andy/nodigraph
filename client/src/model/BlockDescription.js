import { generateId } from './Block.js';

/**
 * A block's ports and properties are edited as plain text in this small,
 * line-oriented format rather than full YAML/JSON — no nesting or quoting
 * rules to teach, and it reads like the block's own spec sheet:
 *
 *   Block: PowerUnit
 *
 *   input.24V: This is the power input
 *   output.5V: This is the output
 *
 *   prop.weight: 2kg
 *   prop.state: ON, OFF, Disabled, Error = ON
 *
 * A leading "-" (as in "- prop.weight: ...") is tolerated but not required,
 * since that's how it naturally gets typed as a bullet list.
 */
const BLOCK_LINE = /^-?\s*Block\s*:\s*(.+)$/i;
const PORT_LINE = /^-?\s*(input|output)\.([^:]+?)\s*:\s*(.*)$/i;
const PROP_LINE = /^-?\s*prop\.([^:]+?)\s*:\s*(.*)$/i;

function parsePropValue(name, rest) {
  const eqIndex = rest.lastIndexOf(' = ');
  if (eqIndex !== -1) {
    const options = rest
      .slice(0, eqIndex)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const current = rest.slice(eqIndex + 3).trim();
    return { name, kind: 'enum', options, value: current || options[0] };
  }
  if (rest.includes(',')) {
    const options = rest
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { name, kind: 'enum', options, value: options[0] };
  }
  return { name, kind: 'value', value: rest };
}

export function parseBlockDescription(text) {
  const lines = (text || '').split('\n');
  let name = null;
  const ports = [];
  const props = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let match = line.match(BLOCK_LINE);
    if (match) {
      name = match[1].trim();
      continue;
    }

    match = line.match(PORT_LINE);
    if (match) {
      ports.push({
        direction: match[1].toLowerCase() === 'input' ? 'in' : 'out',
        name: match[2].trim(),
        description: match[3].trim(),
      });
      continue;
    }

    match = line.match(PROP_LINE);
    if (match) {
      props.push(parsePropValue(match[1].trim(), match[2].trim()));
    }
  }

  return { name, ports, props };
}

export function serializeBlockDescription(block) {
  const lines = [`Block: ${block.name}`];

  const ports = block.ports || [];
  if (ports.length) {
    lines.push('');
    for (const port of ports) {
      const prefix = port.direction === 'in' ? 'input' : 'output';
      lines.push(`${prefix}.${port.name}: ${port.description || ''}`.trimEnd());
    }
  }

  const props = block.props || [];
  if (props.length) {
    lines.push('');
    for (const prop of props) {
      if (prop.kind === 'enum') {
        lines.push(`prop.${prop.name}: ${prop.options.join(', ')} = ${prop.value}`);
      } else {
        lines.push(`prop.${prop.name}: ${prop.value}`);
      }
    }
  }

  return lines.join('\n');
}

// Re-parses the whole text but keeps existing port/prop ids when a line
// still describes the same port (by direction+name) or prop (by name), so
// a text edit doesn't sever connections a later milestone attaches to them.
export function applyDescriptionText(block, text) {
  const parsed = parseBlockDescription(text);
  if (parsed.name) block.name = parsed.name;

  const existingPortsByKey = new Map((block.ports || []).map((p) => [`${p.direction}:${p.name}`, p]));
  block.ports = parsed.ports.map((p) => {
    const existing = existingPortsByKey.get(`${p.direction}:${p.name}`);
    return {
      id: existing?.id || generateId('prt'),
      direction: p.direction,
      name: p.name,
      description: p.description,
    };
  });

  const existingPropsByName = new Map((block.props || []).map((p) => [p.name, p]));
  block.props = parsed.props.map((p) => {
    const existing = existingPropsByName.get(p.name);
    return {
      id: existing?.id || generateId('prp'),
      name: p.name,
      kind: p.kind,
      value: p.value,
      options: p.kind === 'enum' ? p.options : undefined,
    };
  });

  block.description = serializeBlockDescription(block);
}

export function setPropValue(block, propId, value) {
  const prop = (block.props || []).find((p) => p.id === propId);
  if (!prop) return;
  prop.value = value;
  block.description = serializeBlockDescription(block);
}

// Gives the "simulation feel" the user asked for: an output port is tinted
// by the block's own "state" prop (if it has one), so flipping state in the
// inspector visibly changes what the block's outputs look like — a stand-in
// for real signal propagation until connections exist (Milestone 2+).
const STATE_COLOR_RULES = [
  { pattern: /^(on|true|active|running|enabled)$/i, color: '#3ecf5d' },
  { pattern: /^(off|false|idle)$/i, color: '#6b7889' },
  { pattern: /^(error|fault|fail(ed)?)$/i, color: '#e5484d' },
  { pattern: /^(disabled|disable)$/i, color: '#3a4556' },
];

export function getStateColor(block) {
  const stateProp = (block.props || []).find((p) => p.name.toLowerCase() === 'state');
  if (!stateProp) return null;
  const rule = STATE_COLOR_RULES.find((entry) => entry.pattern.test(stateProp.value));
  return rule ? rule.color : '#8b93a3';
}
