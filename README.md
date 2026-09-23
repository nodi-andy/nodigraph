<p align="center">
  <img src="client/icon.svg" width="72" height="72" alt="nodigraph — connected systems, nested detail">
</p>

<h1 align="center">nodigraph</h1>

<p align="center">
  <strong>Understand the system. Explore what is inside.</strong><br>
  Editable block diagrams with nested detail. No account needed — share the whole system in a link.
</p>

<p align="center">
  <a href="https://nodigraph.com"><strong>Try it → nodigraph.com</strong></a>
</p>

<p align="center">
  <a href="https://nodigraph.com/?github=nodi-andy/nodigraph/docs/examples/mobile-robot.yaml">
    <img src="docs/examples/mobile-robot.svg" width="1000" alt="An autonomous mobile robot: sensors on the left feed Perception, then Navigation, Motion controller and Drive units; a safety controller's STO path and the fleet server's telemetry run alongside. Click to open the editable diagram.">
  </a>
</p>

<p align="center">
  <a href="https://nodigraph.com/?github=nodi-andy/nodigraph/docs/examples/mobile-robot.yaml"><strong>Explore this diagram ↗</strong></a><br>
  Double-click <strong>Perception</strong>, <strong>Navigation</strong> or <strong>Drive units</strong>. Every block can contain another system.<br>
  <sub>Written as <a href="docs/examples/mobile-robot.yaml">180 lines of YAML</a> with no coordinates — the layout is automatic · <a href="docs/examples/">More examples</a> · <a href="docs/examples/local-ai.md">Walkthrough of a nested diagram</a></sub>
</p>

---

## What it is

A browser editor for **recursive system architecture**. You draw blocks with
named ports, wire them together, and drill into any block to describe how
*it* is built from smaller blocks — all the way down. Every level is itself
a block with its own interface, the top-level product included.

When you share a diagram, the entire thing is compressed into the URL
(`nodigraph.com/#d=…`). Opening that link needs nothing but a browser: no
sign-up, no server round-trip, nothing of yours retained anywhere. Roughly
100 blocks fit comfortably in a link.

It is not an implementation of OMG SysML. The data model is a small custom
schema aimed at being quick to draw and easy to hand to a colleague.

## Why

Architecture diagrams rot because the picture and its source drift apart.
A PNG lands in a document and six months later nobody can find the file
that made it, so the next person redraws it from scratch.

nodigraph's answer is that there is no separate source file to lose. The
picture's link contains the diagram. **Export to Google Docs** makes this
concrete: one Copy button puts the figure and a linked caption on the
clipboard together, so pasting into a Doc drops in both at once and the
figure in your document carries a working link back to the editable
diagram.

The same idea works for a plain Markdown file in a git repo — export as
SVG, commit it at a stable path, reference that path instead of a
snapshot. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), this repo's
own client architecture, drawn and kept up to date this way.

## Features

- **Recursive decomposition** — drill into any block to model its internals;
  breadcrumbs to navigate back out, and a button to wrap the whole product
  in a new parent when the scope grows.
- **The dotted background is the target** — the dots mark the one
  container the + button will add into, and nothing else: the level you
  are editing while nothing is selected, and the selected block itself the
  moment you pick one. Select an empty block and its face fills with dots;
  that is where the next block lands.
- **See inside without going inside** — zoom in until a block has room to
  spare and its internals draw themselves on its face: the blocks and
  wires alone, to scale and sized to fill it. Zoom back out and it's a
  plain named box again. A block inside a preview opens up too, once
  you're in far enough. Exported figures always read at one level,
  whatever size they're dropped in at.
- **Every block sets its own interior view** — Ctrl (Cmd on a Mac) and
  scroll over a container to give it more or less room inside; Ctrl and
  drag with the middle button to pan what its face shows of the level in
  it. A block holding a dozen children needs a roomier interior than one
  holding two, and that same scale is what decides how far you have to
  zoom in before its level draws itself: a roomy block holds out longer,
  a tight one opens almost as soon as you lean in. Without Ctrl, the
  wheel and the middle button move the camera as always — as does a
  trackpad pinch, which the browser reports as a Ctrl+wheel but which
  never resizes anything.
- **Settings › Show contents** — how early every block opens up, from
  *Much sooner* to *Later*. Sooner draws more of the system at once, each
  level smaller; later keeps the level you are working in clear of
  everything underneath it.
- **Invisible wires** — a connection that is real but would bury the
  picture (a clock into every block, a common ground, the bus everything
  talks to) can be set invisible in the Inspector. The line goes; the
  plugs stay, so each block still shows that it *is* connected, and
  hovering either of its pins brings that one wire back. Nothing is
  deleted, so the diagram never lies about what is wired to what.
- **Ports on a grid** — connectors snap to fixed slots on every edge, so
  wires between blocks line up instead of almost lining up. A new port
  starts undecided — no name, no in/out direction — until you set one in
  the Inspector; it wires up just fine either way, taking on whichever
  direction the other end doesn't already claim.
- **Sockets and plugs** — a port is a socket cut into the block's border:
  a trapezoid dent for an input, a trapezoid tab for an output, a ring for
  a two-way pin. The wire that reaches it fills the socket with a plug in
  its own colour, narrowing the way the data flows. Hover a pin and it
  shows what a press will do: the socket lights up when you are about to
  move the pin along its edge, the plug when you are about to pick the
  wire up.
- **Plug blocks straight together** — push one block up against another so
  an output's tab slides into an input's dent, and the two are connected
  with no wire at all: the outlines meet exactly. Pull the block away again
  and the plug comes out with it; hold Ctrl (Cmd on a Mac) while you let go
  and the connection stays, as an ordinary wire.
- **Resize handles** — select a block to see four diamond handles, one
  per edge, sitting outside the block rather than on its border so they
  never fight with a port for the same touch. Click the dashed line of
  the frame you're inside to select and resize it the same way.
- **Orthogonal routing** — wires pave themselves around blocks, and any wire
  can be routed by hand over as many bends as it needs. Select it and each
  piece gets a handle: drag one to move that piece, tap one to split its
  piece in two, and drag a piece back into line to remove its bend. The
  handles are sized for a finger, so routing works the same on a phone,
  and Reset in the Inspector returns a wire to automatic. Wires that cross
  without joining bow over each other, so a crossing never reads as a
  connection.
- **Labelled, styled pipes** — double-click a wire to name it, in place,
  the same way double-clicking a block renames it. A selected wire (or
  block) opens in the Inspector too, where its label, colour, and line
  style (solid, dashed, dotted) are all editable fields.
- **Block pictures** — a block's name doubles as an image URL: point it at
  a picture instead of typing a label, and that's what fills the block.
- **Multi-select** — shift-click or shift-drag a marquee to toggle blocks
  in and out of a selection; Ctrl/Cmd-click or -drag always adds, and
  Ctrl/Cmd+Shift always removes. Move the group, or copy/paste it (wires
  between selected blocks come along, and nested sub-architecture is
  copied too).
- **Undo/redo** — toolbar buttons, Ctrl/Cmd+Z, and Ctrl/Cmd+Shift+Z or
  Ctrl+Y to redo, across every edit.
- **Flow animation** — Animate marches the wires as moving dashes, from
  each output toward the input it feeds, to show which way things run.
- **Save into the address bar** — Save (or Ctrl/Cmd+S) writes the diagram
  into this page's own URL, so a bookmark or a reload brings it back. A
  dot on the button marks edits that aren't in the address yet.
- **Share by link** — the whole diagram, gzip-compressed into a URL.
- **Local files** — Download/Upload plain JSON, independent of any server.
- **Live sessions** — invite someone with a link and edit the same diagram
  together, blocks mid-drag included. A public broker only introduces the
  two browsers to each other; the diagram itself travels directly between
  them over WebRTC and never reaches a server.
- **Live multi-client editing** — everyone on the same server instance sees
  changes as they happen.

### Planned

Simulation. The same block-and-port model that describes a system can
execute it — that's the direction this is heading, and the reason the
schema is custom rather than SysML-shaped.

## Run it locally

```bash
git clone https://github.com/nodi-andy/nodigraph
cd nodigraph/server && npm install
node src/app.js
```

Then open `http://localhost:8080`. Project data is read from and written
to `data/project.json` (created on first save). Override the folder with
`NODIGRAPH_DATA_DIR` and the port with `PORT`.

### Deploy

The `Dockerfile` at the repo root builds and serves the whole app, so any
container host works. For Cloud Run:

```bash
gcloud run deploy nodigraph --source . --region <region> --allow-unauthenticated
```

The server listens on `PORT`, which Cloud Run sets automatically.

**The Dockerfile disables server-side persistence by default**
(`NODIGRAPH_DISABLE_PERSISTENCE=true`) — a container built from it never
reads or writes `data/project.json`, and never relays anything over its
WebSocket between clients. This matters because the file and the socket
are both singular per running instance: without this, every visitor to a
shared deployment would silently read and write the *same* document, and
see each other's live cursor and drag positions in real time, with no
accounts and no isolation between strangers. That's fine for the "Run it
locally" case above, where you're the only one who can reach the server at
all — it's never fine for a container anyone on the internet can open. Only
unset or override this variable for a deployment you're certain is
single-user and not publicly reachable.

## How it works

| Concern | Approach |
| --- | --- |
| Rendering | One `<canvas>`, drawn by `client/src/render/` |
| State | A plain block tree (`client/src/model/Project.js`) |
| Sharing | `JSON → gzip → base64url → #d=` (`model/shareLink.js`) |
| Server | ~150 lines of Node, one dependency (`ws`) |
| Build step | None. The browser loads ES modules directly. |

### Writing a diagram as text

Export → YAML is a small, hand-editable text format: blocks, their ports, and
the wires between them. Coordinates are optional — a level written without
them is laid out on opening: blocks sized to their text, arranged left to
right along their wires, inputs first, feedback under the row, nested levels
first. So a diagram can be written the way you would describe it, and a
person can then drag things around.

```yaml
name: Zone heating control loop
blocks:
  thermostat:
    name: Room thermostat
    ports:
      sp: { dir: out }
  controller:
    name: Zone controller
    subtitle: PID · 1 s cycle
    ports:
      sp: { dir: in }
      pv: { dir: in }
      cv: { dir: out }
  valve:
    name: Mixing valve
    ports:
      cv: { dir: in }
wires:
  - { from: thermostat.sp, to: controller.sp, label: SP }
  - { from: controller.cv, to: valve.cv, label: CV }
```

### Generating a diagram with an LLM

That format is also the easiest thing to have a model write for you.
[`docs/LLM-AUTHORING.md`](docs/LLM-AUTHORING.md) is a brief for an LLM: link
to it in a prompt and ask for a diagram of a repository, of the documents in
a Drive folder, of a process you describe — what to extract, how to model it,
the format, and how to hand back YAML, JSON or a link. What comes back is a
diagram you can open and keep editing, rather than a flat picture.

### Examples

Six diagrams from different fields, all written without coordinates, in
[`docs/examples/`](docs/examples/): an autonomous mobile robot, a battery
storage system, a SaaS backend drilled down to source files, an HVAC control
loop, a robot cell's safety functions, and an order-to-cash business
process. Each opens live at
`https://nodigraph.com/?github=nodi-andy/nodigraph/docs/examples/<file>.yaml`.

### Command-line tools

Three small Node scripts in `client/tools/`, no install, no browser — the same
model, layout and rendering code the editor runs:

| | |
| --- | --- |
| `node client/tools/lint.mjs diagram.yaml` | checks a diagram the way a reader sees it: wires through blocks, overlapping blocks, colliding labels, pins off their slots, a child painted its container's own colour. Exit 1 on an error; `--json` for data. |
| `node client/tools/layout.mjs diagram.yaml` | prints the YAML with every position filled in; `--json` for the full project; `--link` for a `#d=` share link with the diagram inside it. |
| `node client/tools/svg.mjs diagram.yaml --out figure.svg` | draws a level to SVG; `--level "A/B"` for a nested one, `--all --out-dir` for every level. |

### Known limits

- **Shared links are snapshots, not sessions.** Editing a link produces a
  new link — press Save to write your edits back into the address bar.
  Two people editing the same link will not see each other's changes:
  send the updated link back, or start a live session.
- **Nothing can add a bookmark for you.** Every browser removed the API
  for it years ago, so Save updates the address and names the shortcut;
  pressing it is yours to do.
- **Live sessions are best-effort.** They use the public PeerJS broker,
  which is rate-limited and offers no uptime guarantee, and a direct WebRTC
  connection without a TURN relay is often blocked by strict corporate
  firewalls. Point `peerSession.js` at your own PeerServer and TURN server
  if you need it to be dependable. Edits are last-write-wins, and the
  session ends when the host closes the tab.
- **The optional local server has no real storage, and nothing in the
  product depends on it.** Running `server/src/app.js` yourself (see "Run
  it locally" above) auto-saves whatever you're looking at to a single
  JSON file with no auth, purely as a convenience for picking up where
  you left off on your own machine — anyone who can reach that server
  could read or overwrite it, so don't expose it beyond your own machine.
  Sharing, collaboration and the hosted app at nodigraph.com don't touch
  it at all: a diagram travels in the link itself or peer-to-peer over
  WebRTC, never through this file.
- Very large diagrams (several hundred blocks) can exceed URL length limits
  imposed by proxies, though not by browsers themselves.
- **A block picture needs a CORS-friendly host.** The browser refuses to
  load it otherwise — safely, falling back to the block's plain-text
  name rather than breaking the diagram's own PNG export. Images hosted
  on this same server work automatically.

## License

AGPL-3.0 (see [LICENSE](LICENSE)) — free to use, modify and self-host. If
you run a modified version as a network service, you must make that
version's source available to its users; this is what keeps the project
itself (and any improvements made to it) open, the same model Mermaid and
similar community-run tools use.

A separate commercial license is available for anyone who wants to run a
modified or embedded version as a closed-source, proprietary service
without that source-sharing obligation — the same dual-licensing model
used by projects like MongoDB and Qt. There's no self-serve process for
this yet; open an issue or otherwise get in touch to ask about one.

