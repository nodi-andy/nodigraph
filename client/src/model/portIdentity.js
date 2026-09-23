// Several physical pins may expose the same named interface. Treat pins
// with the same non-empty name and direction as one logical port while
// retaining every physical pin and its placement.
export function coalesceSameNamedPorts(block, preferredLogicalId = null) {
  const logicalPorts = block?.logicalPorts || [];
  const pins = block?.ports || [];
  const groups = new Map();

  for (const logical of logicalPorts) {
    if (!logical.name) continue;
    const key = `${logical.direction ?? ''}:${logical.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(logical);
  }

  const replacement = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = group.find((logical) => logical.id === preferredLogicalId) || group[0];
    for (const logical of group) {
      if (logical.id !== canonical.id) replacement.set(logical.id, canonical.id);
    }
  }

  if (!replacement.size) return false;
  for (const pin of pins) pin.logicalId = replacement.get(pin.logicalId) || pin.logicalId;
  block.logicalPorts = logicalPorts.filter((logical) => !replacement.has(logical.id));
  return true;
}
