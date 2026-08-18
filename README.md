# block-modeler

Browser-based visual editor for product specification: define a product,
its interfaces, requirements, and architecture, with components
recursively decomposed the same way. Every level you view is itself a
block with its own ports/props/description — the product root included —
and its own boundary frame for editing that level's interface. Not tied
to formal OMG SysML; the data model is a small custom schema designed for
this tool.

See the build plan for full architecture and the milestone roadmap.

## Requirement relation model

Carried over from the original ReGit concept and still the model for how
requirements relate to each other here: a requirement has an `ID`,
`Description`, `Location`, `Parents`, `Childs`, `Ver`, and `State`. Parents
and Childs are how one requirement traces to another (e.g. a component's
requirement traces up to the product requirement it satisfies). This isn't
implemented as its own feature yet — it's the shape future requirement
blocks/traceability in the canvas should follow.

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
  a one-way publish target — click the **⚙** next to Update Doc once to
  paste the target Doc's URL, then **Update Doc** appends every block's
  current description (and, for a block with children, its diagram as an
  inline image) to the end of that doc. Nothing already in the doc is read
  or touched — only ever appended to. Sign-in is a plain Google OAuth popup
  the first time (via Google Identity Services, no Apps Script, no
  backend) — see `client/src/model/googleAuth.js` and
  `client/src/model/googleDocSync.js`.

### Run it

```bash
cd server && npm install   # only needed once, or after pulling changes to server/package.json
node src/app.js
```

Then open the printed URL (default `http://localhost:8080`). Project data
is read from and written to `data/project.json` (created on first save).
Override the folder with `BLOCK_MODELER_DATA_DIR`, and the port with `PORT`.

### Deploy (Cloud Run)

The `Dockerfile` at the repo root builds and serves the whole app (client +
server), same pattern as `nodiwar`/`conucon`: no separate build step, no
`cloudbuild.yaml` — just deploy the source directly.

```bash
gcloud run deploy block-modeler --source . --region <region> --allow-unauthenticated
```

The server listens on `PORT` (Cloud Run sets this to `8080` automatically).
Project data is written to disk inside the container, so it does not
survive a redeploy or new revision yet — fine for trying out the editor,
not yet for durable storage (see "Doc sync" above, or a future persistent
volume/database).

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
