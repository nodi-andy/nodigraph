<p align="center">
  <img src="client/icon.svg" width="72" height="72" alt="">
</p>

<h1 align="center">noditron</h1>

<p align="center">
  <strong>Block diagrams that live in the URL.</strong><br>
  No account, no database, nothing stored on a server — the link <em>is</em> the file.
</p>

<p align="center">
  <a href="https://noditron.com"><strong>Try it → noditron.com</strong></a>
</p>

<p align="center">
  <img src="docs/screenshot.png" width="900" alt="A Beacon Unit system: Power Supply, MCU, LED Driver and Sensor Head blocks wired together through named ports">
</p>

---

## What it is

A browser editor for **recursive system architecture**. You draw blocks with
named ports, wire them together, and drill into any block to describe how
*it* is built from smaller blocks — all the way down. Every level is itself
a block with its own interface, the top-level product included.

When you share a diagram, the entire thing is compressed into the URL
(`noditron.com/?d=…`). Opening that link needs nothing but a browser: no
sign-up, no server round-trip, nothing of yours retained anywhere. Roughly
100 blocks fit comfortably in a link.

It is not an implementation of OMG SysML. The data model is a small custom
schema aimed at being quick to draw and easy to hand to a colleague.

## Why

Architecture diagrams rot because the picture and its source drift apart.
A PNG lands in a document and six months later nobody can find the file
that made it, so the next person redraws it from scratch.

noditron's answer is that there is no separate source file to lose. The
picture's link contains the diagram. The **Share → Google Docs** tab makes
this concrete: it hands you the figure image plus the alt-text values to
paste with it, so the figure in your document carries a working link back
to the editable diagram.

## Features

- **Recursive decomposition** — drill into any block to model its internals;
  breadcrumbs to navigate back out, and a button to wrap the whole product
  in a new parent when the scope grows.
- **Ports on a grid** — connectors snap to fixed slots on every edge, so
  wires between blocks line up instead of almost lining up.
- **Resize handles** — select a block to see four floating handles, one
  per edge, sitting outside the block rather than on its border so they
  never fight with a port for the same touch. The container frame you're
  inside shows its own handles the same way, always.
- **Orthogonal routing** — wires pave themselves around blocks, with a
  draggable trunk segment when you want a different route. Wires that cross
  without joining bow over each other, so a crossing never reads as a
  connection.
- **Coloured pipes** — click any wire (or any block) and give it a colour
  from the palette beside the add button, to group the pipes that belong
  together.
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
git clone https://github.com/nodi-andy/noditron
cd noditron/server && npm install
node src/app.js
```

Then open `http://localhost:8080`. Project data is read from and written
to `data/project.json` (created on first save). Override the folder with
`NODITRON_DATA_DIR` and the port with `PORT`.

### Deploy

The `Dockerfile` at the repo root builds and serves the whole app, so any
container host works. For Cloud Run:

```bash
gcloud run deploy noditron --source . --region <region> --allow-unauthenticated
```

The server listens on `PORT`, which Cloud Run sets automatically. Project
data is written inside the container and does not survive a redeploy —
fine for the shared-link workflow, not yet durable storage.

## How it works

| Concern | Approach |
| --- | --- |
| Rendering | One `<canvas>`, drawn by `client/src/render/` |
| State | A plain block tree (`client/src/model/Project.js`) |
| Sharing | `JSON → gzip → base64url → ?d=` (`model/shareLink.js`) |
| Server | ~150 lines of Node, one dependency (`ws`) |
| Build step | None. The browser loads ES modules directly. |

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
- Server-side storage is a single JSON file with no auth. Anyone who can
  reach the server can edit it.
- Very large diagrams (several hundred blocks) can exceed URL length limits
  imposed by proxies, though not by browsers themselves.

## License

Not yet chosen — until one is added here, the default applies and all
rights are reserved. AGPL-3.0 is the intended direction (free to use,
modify and self-host; publish your changes if you run a modified version
as a network service).
