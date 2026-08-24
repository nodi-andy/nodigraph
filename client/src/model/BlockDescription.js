import { generateId } from './Block.js';
import { sideAxis, getPortSlotOffsets, nearestPortSlot } from './grid.js';

/**
 * A block's ports and properties are edited as plain text in this small,
 * line-oriented format rather than full YAML/JSON — no nesting or quoting
 * rules to teach, and it reads like the block's own spec sheet:
 *
 *   Block: PowerUnit
 *
 *   input.24V: This is the power input
 *   output.5V: This is the output
 *   port.Aux: Not yet wired up, direction undecided
 *
 *   prop.weight: 2kg
 *   prop.state: ON, OFF, Disabled, Error = ON
 *
 * A leading "-" (as in "- prop.weight: ...") is tolerated but not required,
 * since that's how it naturally gets typed as a bullet list. `port.` (as
 * opposed to `input.`/`output.`) is a port with no direction committed yet
 * — see addPort's own note on why a new port starts that way. It still
 * needs a name to appear as a line here at all; one added with no name
 * (only possible from the Inspector, which has no name to type before a
 * click) has no way to be written as a `prefix.NAME: ...` line and simply
 * doesn't round-trip through this text — applyDescriptionText knows to
 * leave those alone rather than treat their absence as "deleted."
 */
const BLOCK_LINE = /^-?\s*Block\s*:\s*(.+)$/i;
const PORT_LINE = /^-?\s*(input|output|port)\.([^:]+?)\s*:\s*(.*)$/i;
const PROP_LINE = /^-?\s*prop\.([^:]+?)\s*:\s*(.*)$/i;

// input./output. always mean the same real direction; a bare port. line
// means "undecided," stored as null the same way a port created from the
// Inspector without picking one yet is.
function directionFromPrefix(prefix) {
  const lower = prefix.toLowerCase();
  if (lower === 'input') return 'in';
  if (lower === 'output') return 'out';
  return null;
}

function prefixFromDirection(direction) {
  if (direction === 'in') return 'input';
  if (direction === 'out') return 'output';
  return 'port';
}

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
        direction: directionFromPrefix(match[1]),
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
  // A port with no name can't be written as a line at all — the format is
  // prefix.NAME: ..., and there's no NAME to put there. Left out of the
  // text rather than given a fake placeholder; applyDescriptionText knows
  // not to read that absence as "deleted."
  const namedPorts = ports.filter((p) => p.name);
  if (namedPorts.length) {
    lines.push('');
    for (const port of namedPorts) {
      const prefix = prefixFromDirection(port.direction);
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
  const parsedPorts = parsed.ports.map((p) => {
    const existing = existingPortsByKey.get(`${p.direction}:${p.name}`);
    const manualOffset = existing?.manualOffset || false;
    return {
      id: existing?.id || generateId('prt'),
      direction: p.direction,
      name: p.name,
      description: p.description,
      // Inputs default to the left, outputs to the right — an undecided
      // port defaults left too, the same as an input, since it has no
      // "out" pull yet. Dragging a port around the block's perimeter can
      // move it to any side regardless.
      side: existing?.side || (p.direction === 'out' ? 'right' : 'left'),
      // Only a *dragged* offset survives re-parsing; an auto-placed one is
      // recomputed below so it can't collide with a newly added sibling on
      // the same side.
      offset: manualOffset ? existing.offset : undefined,
      manualOffset,
    };
  });
  // A nameless port (only possible from the Inspector's "+ Add port",
  // which has no name typed yet to give it a line here) never appears in
  // the text at all — carried over untouched rather than read as "this
  // line disappeared, so delete it."
  const untouched = (block.ports || []).filter((p) => !p.name);
  block.ports = [...parsedPorts, ...untouched];
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
    // Manually-placed ports on this side are fixed points auto-layout has
    // to dodge, not just other auto ports to space evenly against —
    // compared by resolved slot (nearestPortSlot), not raw offset, so a
    // port saved before slots existed still correctly reserves whichever
    // slot it now actually renders at (see BlockRenderer.getPortPosition).
    const taken = new Set(sidePorts.filter((p) => p.manualOffset).map((p) => nearestPortSlot(sideLength, p.offset)));
    const freeSlots = getPortSlotOffsets(sideLength).filter((s) => !taken.has(s));

    autoPorts.forEach((port, i) => {
      // More auto ports than free slots on this side: cycle back through
      // them rather than drifting off the slot grid — a shared slot is
      // rare and still reads better than a port that lines up with none.
      port.offset = freeSlots.length ? freeSlots[i % freeSlots.length] : sideLength / 2;
    });
  }
}

// Adds a port directly (from a border click on the canvas, or the
// Inspector's own "+ Add port" button) rather than through the text editor
// — still keeps `description` in sync so the two views never disagree.
// `side`/`offset` come from wherever the user actually clicked; when
// omitted (the Inspector button has no click position to go on) the port
// defaults to the left and gets auto-placed.
//
// `direction` defaults to null, not 'in' — a brand new port is neither an
// input nor an output yet, just a socket waiting to be one of those (or
// neither, if it's never wired to anything). Naming it "In3" before it's
// actually an input would be a claim the port hasn't earned; leaving both
// name and direction blank means there's nothing to contradict once the
// user does pick one, in the Inspector, whenever — or never — they want to.
export function addPort(block, { direction = null, side, offset } = {}) {
  // A text block is a plain floating label (see Block.createBlock) — it
  // has no sockets to wire, regardless of which UI gesture asked for one.
  if (block.kind === 'text') return null;
  const resolvedSide = side || (direction === 'out' ? 'right' : 'left');
  const countSameDirection = direction ? block.ports.filter((p) => p.direction === direction).length : 0;
  const port = {
    id: generateId('prt'),
    direction,
    name: direction ? `${direction === 'out' ? 'Out' : 'In'}${countSameDirection + 1}` : '',
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
