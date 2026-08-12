const CYCLE_MS = 1500;

// Pure function of a timestamp (not internal state) so it's trivial to test
// and so every connection's dot stays in phase with every other one.
export function getFlowPhase(timestampMs) {
  return (timestampMs % CYCLE_MS) / CYCLE_MS;
}
