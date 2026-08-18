import { generateId } from './Block.js';
import { snap, sideAxis, getPortOffsetBounds, GRID_SIZE } from './grid.js';

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
    const manualOffset = existing?.manualOffset || false;
    return {
      id: existing?.id || generateId('prt'),
      direction: p.direction,
      name: p.name,
      description: p.description,
      // Inputs default to the left, outputs to the right — dragging a port
      // around the block's perimeter can move it to any side.
      side: existing?.side || (p.direction === 'out' ? 'right' : 'left'),
      // Only a *dragged* offset survives re-parsing; an auto-placed one is
      // recomputed below so it can't collide with a newly added sibling on
      // the same side.
      offset: manualOffset ? existing.offset : undefined,
      manualOffset,
    };
  });
  assignDefaultPortOffsets(block);

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

// Ports without an explicit offset (brand new, just parsed from text) get
// evenly distributed among *themselves* along whichever side they're on —
// deliberately not mixed in with already-placed ports' indices, since that
// previously let two new same-side ports round to the exact same offset.
// A dragged port's offset is never touched here.
export function assignDefaultPortOffsets(block) {
  const { width, height } = block.geometry;

  for (const side of ['left', 'right', 'top', 'bottom']) {
    const sidePorts = block.ports.filter((p) => p.side === side);
    const autoPorts = sidePorts.filter((p) => p.offset === undefined || p.offset === null);
    if (!autoPorts.length) continue;

    const sideLength = sideAxis(side) === 'x' ? height : width;
    const bounds = getPortOffsetBounds(sideLength);
    const step = (bounds.max - bounds.min) / (autoPorts.length + 1);
    // Manually-placed ports on this side are fixed points auto-layout has
    // to dodge, not just other auto ports to space evenly against.
    const taken = new Set(sidePorts.filter((p) => p.manualOffset).map((p) => p.offset));

    autoPorts.forEach((port, i) => {
      let offset = snap(bounds.min + step * (i + 1));
      while (taken.has(offset) && offset + GRID_SIZE <= bounds.max) offset += GRID_SIZE;
      taken.add(offset);
      port.offset = offset;
    });
  }
}

// Adds a port directly (from a border click on the canvas, or the
// Inspector's own "+ Add port" button) rather than through the text editor
// — still keeps `description` in sync so the two views never disagree.
// `side`/`offset` come from wherever the user actually clicked; when
// omitted (the Inspector button has no click position to go on) the port
// defaults to its direction's usual side and gets auto-placed.
export function addPort(block, { direction = 'in', side, offset } = {}) {
  const resolvedSide = side || (direction === 'out' ? 'right' : 'left');
  const countSameDirection = block.ports.filter((p) => p.direction === direction).length;
  const port = {
    id: generateId('prt'),
    direction,
    name: `${direction === 'out' ? 'Out' : 'In'}${countSameDirection + 1}`,
    description: '',
    side: resolvedSide,
    offset,
    manualOffset: offset !== undefined && offset !== null,
  };
  block.ports.push(port);
  if (port.offset === undefined || port.offset === null) assignDefaultPortOffsets(block);
  block.description = serializeBlockDescription(block);
  return port;
}

export function removePort(block, portId) {
  block.ports = block.ports.filter((p) => p.id !== portId);
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
