# gravis-sysml

Browser-based visual editor for product specification: define a product,
its interfaces, requirements, and architecture, with components
recursively decomposed the same way. Every level you view is itself a
block with its own ports/props/description — the product root included —
and its own boundary frame for editing that level's interface. Not tied
to formal OMG SysML; the data model is a small custom schema designed for
this tool.

See the build plan for full architecture and the milestone roadmap.

## Current state

- Canvas: pan/zoom, add/move/resize blocks, ports on any side (draggable,
  click a border to add one), orthogonal "paved" wires with a draggable
  trunk segment, drill into/out of a block to edit its own architecture.
- Data: a minimal Node server (`server/src/app.js`, no dependencies)
  serves the client and persists the whole project as one JSON file on
  disk (`data/project.json`) — no git integration yet, and no
  multi-user/auth (still single local user).

### Run it

```bash
node server/src/app.js
```

Then open the printed URL (default `http://localhost:8080`). Project data
is read from and written to `data/project.json` (created on first save).
Override the folder with `GRAVIS_DATA_DIR`, and the port with `PORT`.
