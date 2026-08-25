import { generateId } from './Block.js';
import { sideAxis, getPortSlotOffsets, nearestPortSlot } from './grid.js';

/**
 * A block's interface is a `logicalPorts` list — each entry a named,
 * directional pin *definition* (id/name/direction/description), unique by
 * name — plus a `ports` list of *pins*: the actual clickable/wireable
 * sockets drawn on the block's edge, each just placement (id/side/offset)
 * and a `logicalId` pointing at the logical port it belongs to. A logical
 * port always has at least one pin (there's nothing to show or wire
 * otherwise); it can have more than one when a pin has been cloned (see
 * clonePort) — every wire a container block can carry it own only tolerates
 * one wire per pin from outside (Project.addConnection), so a second,
 * separately-wired *pin* is how the same interface reaches two places,
 * without pretending to be two different interfaces. From inside the
 * container, every pin belonging to the same logical port collapses back
 * onto the one pin you'd see and wire (see Project.listBoundaryPorts).
 *
 * The text format below (block.description) is a spec sheet for the
 * *logical* ports only — placement isn't something you'd type:
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
 * opposed to `input.`/`output.`) is a logical port with no direction
 * committed yet — see addPort's own note on why a new one starts that way.
 * It still needs a name to appear as a line here at all; one added with no
 * name (only possible from the Inspector, which has no name to type before
 * a click) has no way to be written as a `prefix.NAME: ...` line and simply
 * doesn't round-trip through this text — applyDescriptionText knows to
 * leave those alone rather than treat their absence as "deleted."
 */
const BLOCK_LINE = /^-?\s*Block\s*:\s*(.+)$/i;
const PORT_LINE = /^-?\s*(input|output|port)\.([^:]+?)\s*:\s*(.*)$/i;
const PROP_LINE = /^-?\s*prop\.([^:]+?)\s*:\s*(.*)$/i;

// input./output. always mean the same real direction; a bare port. line
// means "undecided," stored as null the same way a logical port created
// from the Inspector without picking one yet is.
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

  const logicalPorts = block.logicalPorts || [];
  // A logical port with no name can't be written as a line at all — the
  // format is prefix.NAME: ..., and there's no NAME to put there. Left out
  // of the text rather than given a fake placeholder; applyDescriptionText
  // knows not to read that absence as "deleted."
  const namedPorts = logicalPorts.filter((p) => p.name);
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

// Re-parses the whole text but keeps an existing logical port's id (and
// every pin it already has) when a line still describes the same one (by
// direction+name), so a text edit doesn't sever connections a later
// milestone attaches to them. A line with no existing match becomes a
// brand new logical port *and* its first pin — a logical port never exists
// with nothing to show on the block's edge. A logical port whose line
// disappeared is removed entirely, taking every pin it had with it.
export function applyDescriptionText(block, text) {
  const parsed = parseBlockDescription(text);
  if (parsed.name) block.name = parsed.name;

  const existingLogicalByKey = new Map((block.logicalPorts || []).map((lp) => [`${lp.direction}:${lp.name}`, lp]));
  const nextLogicalPorts = [];
  for (const p of parsed.ports) {
    const existing = existingLogicalByKey.get(`${p.direction}:${p.name}`);
    if (existing) {
      existing.description = p.description;
      nextLogicalPorts.push(existing);
      continue;
    }
    const logical = { id: generateId('io'), direction: p.direction, name: p.name, description: p.description };
    nextLogicalPorts.push(logical);
    // Inputs default to the left, outputs to the right — an undecided
    // logical port defaults left too, the same as an input, since it has
    // no "out" pull yet. Dragging the pin around the block's perimeter can
    // move it to any side regardless.
    block.ports.push({
      id: generateId('prt'),
      logicalId: logical.id,
      side: p.direction === 'out' ? 'right' : 'left',
      offset: undefined,
      manualOffset: false,
    });
  }
  // A nameless logical port (only possible from the Inspector's "+ Add
  // port", which has no name typed yet to give it a line here) never
  // appears in the text at all — carried over untouched rather than read
  // as "this line disappeared, so delete it."
  const untouchedLogical = (block.logicalPorts || []).filter((lp) => !lp.name);
  block.logicalPorts = [...nextLogicalPorts, ...untouchedLogical];

  // Every pin whose logical port survived (matched, or untouched/nameless)
  // keeps its placement exactly as it was — text editing has nothing to
  // say about that. A pin whose logical port didn't make the cut goes with
  // it: the interface point it belonged to no longer exists.
  const survivingLogicalIds = new Set(block.logicalPorts.map((lp) => lp.id));
  block.ports = block.ports.filter((pin) => survivingLogicalIds.has(pin.logicalId));
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

// Pins without an explicit offset (brand new) get evenly distributed among
// *themselves* along whichever side they're on — deliberately not mixed in
// with already-placed pins' indices, since that previously let two new
// same-side pins round to the exact same offset. A dragged pin's offset is
// never touched here.
export function assignDefaultPortOffsets(block) {
  const { width, height } = block.geometry;

  for (const side of ['left', 'right', 'top', 'bottom']) {
    const sidePins = block.ports.filter((p) => p.side === side);
    const autoPins = sidePins.filter((p) => p.offset === undefined || p.offset === null);
    if (!autoPins.length) continue;

    const sideLength = sideAxis(side) === 'x' ? height : width;
    // Manually-placed pins on this side are fixed points auto-layout has
    // to dodge, not just other auto pins to space evenly against —
    // compared by resolved slot (nearestPortSlot), not raw offset, so a
    // pin saved before slots existed still correctly reserves whichever
    // slot it now actually renders at (see BlockRenderer.getPortPosition).
    const taken = new Set(sidePins.filter((p) => p.manualOffset).map((p) => nearestPortSlot(sideLength, p.offset)));
    const freeSlots = getPortSlotOffsets(sideLength).filter((s) => !taken.has(s));

    autoPins.forEach((pin, i) => {
      // More auto pins than free slots on this side: cycle back through
      // them rather than drifting off the slot grid — a shared slot is
      // rare and still reads better than a pin that lines up with none.
      pin.offset = freeSlots.length ? freeSlots[i % freeSlots.length] : sideLength / 2;
    });
  }
}

// Adds a brand new logical port *and* its first pin (from a border click
// on the canvas, or the Inspector's own "+ Add port" button) rather than
// through the text editor — still keeps `description` in sync so the two
// views never disagree. `side`/`offset` come from wherever the user
// actually clicked; when omitted (the Inspector button has no click
// position to go on) the pin defaults to the left and gets auto-placed.
// Returns the pin (what gets selected/dragged immediately after).
//
// `direction` defaults to null, not 'in' — a brand new logical port is
// neither an input nor an output yet, just a socket waiting to be one of
// those (or neither, if it's never wired to anything). Naming it "In3"
// before it's actually an input would be a claim it hasn't earned; leaving
// both name and direction blank means there's nothing to contradict once
// the user does pick one, in the Inspector, whenever — or never — they want to.
export function addPort(block, { direction = null, side, offset } = {}) {
  // A text block is a plain floating label (see Block.createBlock) — it
  // has no sockets to wire, regardless of which UI gesture asked for one.
  if (block.kind === 'text') return null;
  const resolvedSide = side || (direction === 'out' ? 'right' : 'left');
  const countSameDirection = direction ? (block.logicalPorts || []).filter((p) => p.direction === direction).length : 0;
  const logical = {
    id: generateId('io'),
    direction,
    name: direction ? `${direction === 'out' ? 'Out' : 'In'}${countSameDirection + 1}` : '',
    description: '',
  };
  block.logicalPorts = [...(block.logicalPorts || []), logical];
  const pin = {
    id: generateId('prt'),
    logicalId: logical.id,
    side: resolvedSide,
    offset,
    manualOffset: offset !== undefined && offset !== null,
  };
  block.ports.push(pin);
  if (pin.offset === undefined || pin.offset === null) assignDefaultPortOffsets(block);
  block.description = serializeBlockDescription(block);
  return pin;
}

// Adds another pin for `sourcePin`'s *same* logical port — dropped onto
// the nearest free slot beside it rather than on top of it — for the
// "hold Alt and drag" clone gesture (see DragStateMachine's onPointerDown,
// which only ever offers this on a pin's exterior; from inside, a logical
// port already gets unlimited fan-out some other way — see
// Project.listBoundaryPorts). No new logical port, no name/direction/
// description to copy — the clone shares its source's identity by
// construction (same `logicalId`), it just gives that one interface a second,
// independently wireable spot on the block's edge, which is what actually
// lets it carry a second wire out of a container block otherwise capped at
// one wire per pin from outside (see Project.addConnection).
export function clonePort(block, sourcePin, sideLength) {
  const occupied = block.ports
    .filter((p) => p.side === sourcePin.side)
    .map((p) => nearestPortSlot(sideLength, p.offset));
  const pin = {
    id: generateId('prt'),
    logicalId: sourcePin.logicalId,
    side: sourcePin.side,
    offset: nearestPortSlot(sideLength, sourcePin.offset, occupied),
    manualOffset: true,
  };
  block.ports.push(pin);
  return pin;
}

// Removes one pin. If that was its logical port's last one, the logical
// port goes with it — see the module doc: a logical port never exists
// with nothing to show or wire on the block's edge, so it can't be left
// behind once nothing points at it anymore. This is the *pin*-level
// removal — a specific exterior instance, selected on the canvas — not
// what the Inspector's own "Ports" list uses (see removeLogicalPort).
export function removePort(block, pinId) {
  const pin = block.ports.find((p) => p.id === pinId);
  if (!pin) return;
  block.ports = block.ports.filter((p) => p.id !== pinId);
  const stillReferenced = block.ports.some((p) => p.logicalId === pin.logicalId);
  if (!stillReferenced) {
    block.logicalPorts = (block.logicalPorts || []).filter((lp) => lp.id !== pin.logicalId);
  }
  block.description = serializeBlockDescription(block);
}

// Removes a whole logical port — every pin that references it goes too.
// This is what the Inspector's "Ports" list itself deletes by (it manages
// the logical interface, one row per logical port, never one row per
// pin — see InspectorPanel's own note): deleting "P1" there means the
// interface no longer exists, not just whichever one of its exterior
// instances happened to be listed first. Returns the removed pins' ids so
// the caller can drop any wires that referenced them (see
// Project.removeConnectionsForPort) — this function only ever touches the
// block's own port/pin lists, never connections, same division every
// other port-removal here keeps.
export function removeLogicalPort(block, logicalId) {
  const removedPinIds = block.ports.filter((p) => p.logicalId === logicalId).map((p) => p.id);
  block.ports = block.ports.filter((p) => p.logicalId !== logicalId);
  block.logicalPorts = (block.logicalPorts || []).filter((lp) => lp.id !== logicalId);
  block.description = serializeBlockDescription(block);
  return removedPinIds;
}

// The logical port a pin belongs to — its identity (name/direction/
// description), as opposed to the pin's own placement (side/offset). Every
// pin references exactly one of these; several pins can share one (see
// clonePort). Returns null for a pin whose logical port is somehow gone
// (shouldn't happen — removePort always takes both together — but every
// caller reads through this rather than assuming, same defensive habit as
// any other id-lookup in this codebase).
export function logicalPortOf(block, pin) {
  return (block?.logicalPorts || []).find((lp) => lp.id === pin?.logicalId) || null;
}

// The first available "base", "base 2", "base 3", ... against every other
// logical port's current name on this block (`excludeId` leaves the one
// being renamed out of its own collision check). Used only to disambiguate
// an actual rename collision — two logical ports ending up with the same
// name by accident, which would make them unable to be told apart in the
// Inspector's own port list. Cloning a pin is the sanctioned way for two
// exterior instances to legitimately share one name; this only ever
// applies when someone types a *different* logical port into an existing
// name.
export function uniqueLogicalPortName(block, baseName, excludeId) {
  if (!baseName) return baseName;
  const taken = new Set((block.logicalPorts || []).filter((lp) => lp.id !== excludeId).map((lp) => lp.name));
  if (!taken.has(baseName)) return baseName;
  let n = 2;
  while (taken.has(`${baseName} ${n}`)) n += 1;
  return `${baseName} ${n}`;
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
