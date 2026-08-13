# block-modeler

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
- Data: a minimal Node server (`server/src/app.js`) serves the client and
  persists the whole project as one JSON file on disk
  (`data/project.json`) — no git integration yet, and no auth (anyone who
  can reach the server can edit; still no per-user accounts).
- Sync: multiple open clients (tabs, or other people on the same network)
  see each other's changes live over a WebSocket, including a block's
  position while it's still being dragged, not just once it's dropped —
  see "Real-time sync" below for how this works and its limits.
- Doc sync (optional): the tool stays the source of truth; a Google Doc is
  a one-way publish target you write freely — paste a "Copy Doc region"
  snippet (from the Inspector) anywhere you want a block's description +
  diagram to live, and **Update Doc** refreshes just those spots in place.
  Everything else you've written in the Doc is never touched. See
  `appsscript/README.md` for setup (no Google Cloud project needed).

### Run it

```bash
cd server && npm install   # only needed once, or after pulling changes to server/package.json
node src/app.js
```

Then open the printed URL (default `http://localhost:8080`). Project data
is read from and written to `data/project.json` (created on first save).
Override the folder with `BLOCK_MODELER_DATA_DIR`, and the port with `PORT`.

### Real-time sync

The server keeps a WebSocket open per connected client (`ws`, the one
runtime dependency this project has). Two kinds of messages travel over
it:

- **`project`** — broadcast to every client right after any client's save
  lands on disk. This is the same data `GET /api/project` would return;
  each client re-hydrates its in-memory model from it, but skips doing so
  while it's itself mid-drag or mid-typing, so an incoming update can't
  wipe out an unsaved local edit.
- **`live`** — sent by whichever client is actively dragging a block,
  port, wire trunk, or boundary edge, on every pointer move, and relayed
  to every *other* client as-is. Never written to disk (only the eventual
  save, on release, is); a receiving client just patches the one thing
  that moved.

This gives last-write-wins sync with low latency, not real conflict
resolution — two people editing the *same* thing at the *same* moment
will still clobber each other. Proper concurrent-edit handling (locking,
merge, or presence) is still a later milestone, not something this
implements.
