# Turning a codebase, a folder of documents, or a description into a nodigraph diagram

**A brief for an LLM.** A person links to this file in their prompt and asks
for a diagram of something — a repository, the files in a Google Drive
folder, a product they describe, a business process. You read the source
material, work out what the system is made of and how the parts connect,
and write **one YAML document** in the format below. The person opens it in
[nodigraph](https://nodigraph.com) and keeps editing it by hand; the editor
lays it out.

Typical prompts this brief is meant to answer:

> Read https://github.com/nodi-andy/nodigraph/blob/main/docs/LLM-AUTHORING.md,
> then go through this repository and give me its architecture as a
> nodigraph diagram — one block per service, drill into the order service.

> Following that brief, read every document in my Drive folder "Plant 3
> retrofit" and draw the control system: sensors, PLCs, drives, networks.

> Same brief: model our order-to-cash process as a nodigraph, one block per
> step, the documents that move between them as wires.

What you hand back is the YAML (and, when asked, the JSON or a link — see
[Delivering the result](#delivering-the-result)). Emit no PNG, no Mermaid, no
prose diagram. Everything below is the format the editor itself exports, so
anything you write here round-trips.

---

## The short version

1. **Read the material** and decide what the system *is*: its top level, its
   inputs and outputs, and 5–12 main parts. Anything with real internal
   structure becomes a block you can drill into (its own `blocks`/`wires`).
2. **Model, don't transcribe.** Blocks are components, services, machines,
   process steps, roles. Wires are what flows between them: a signal, a
   message, a document, a current. Ports are the named connection points on
   a block. Give things the names the source material uses.
3. **Write the YAML with no coordinates.** Leave `x`, `y`, `w`, `h` and port
   `offset` out; the editor sizes every block to its text and lays each
   level out left to right, inputs first (see [Layout](#layout)). Only
   place things by hand when the person asks for a particular arrangement.
4. **Check it with the linter, not with one of your own.** It lives in the
   nodigraph repository, not in whatever repository you are reading, so
   fetch it first — see
   [Before you hand it over](#before-you-hand-it-over). If you genuinely
   cannot run it, walk the checklist there; do not write your own checker.
5. **Hand it over** as a YAML code block, plus whichever of JSON / link /
   picture the person asked for.

---

## Cheat sheet

```yaml
name: Zone heating control loop           # the product / top level
blocks:                                   # a mapping, NOT a list. Key = local id.
  setpoint:
    name: Room thermostat
    subtitle: setpoint 21 °C · schedule   # optional smaller line under the title
    color: "#4a6fa5"                      # BORDER colour, quoted because of #
    fill: "#e3eaf7"                       # background
    ports:
      sp: { name: setpoint, dir: out }    # one port per line, in `{ … }` flow style
  controller:
    name: Zone controller
    subtitle: PID · 1 s cycle
    lines:                                # optional monospace detail rows
      - Kp 4 %/K · Ti 600 s
    ports:
      sp: { dir: in }
      pv: { name: measured, dir: in }
      cv: { name: 0–10 V, dir: out }
    blocks:                               # this block can be drilled into
      error:
        name: Error
        lines:
          - e = SP − PV
        ports:
          sp: { dir: in }
          pv: { dir: in }
          e: { dir: out }
      pid:
        name: PID terms
        ports:
          e: { dir: in }
          cv: { dir: out }
    wires:
      - self.sp -> error.sp               # `self` = the enclosing block's own port
      - self.pv -> error.pv
      - error.e -> pid.e
      - pid.cv -> self.cv
  valve:
    name: Mixing valve
    ports:
      cv: { dir: in }
      flow: { dir: out }
  sensor:
    name: Temperature sensor
    ports:
      t: { dir: in }
      pv: { dir: out }
wires:
  - { from: setpoint.sp, to: controller.sp, label: SP }
  - { from: controller.cv, to: valve.cv, label: CV }
  - valve.flow -> sensor.t
  - { from: sensor.pv, to: controller.pv, label: feedback, color: "#16836e" }
```

Six rules that cause almost every mistake:

1. **`blocks` is a mapping keyed by id**, not a sequence. `wires` *is* a sequence.
2. **Indent exactly 2 spaces per level.** The reader is a small purpose-built
   parser, not a full YAML implementation.
3. **Never put a comma inside an unquoted value** — it splits a `{ … }` record.
   Quote it: `label: "a, b"`.
4. **A `{ … }` record cannot contain another `{ … }`.** One level of flow only:
   `p1: { dir: in }` is fine, `b1: { name: X, ports: { … } }` silently turns the
   inner record into a meaningless string. Write blocks in block style and
   keep flow style for ports and wires.
5. **`color` is the border, `fill` is the background.** There is no text-colour
   field. Hex colours must be quoted, because `#` starts a comment.
6. **Every wire endpoint is `blockKey.portKey`**, both of which must exist at
   that level (or `self.portKey` for the enclosing block). A wire to a key that
   does not exist is dropped without a message.

---

## Reading the source material

What to extract depends on what you were given. Whatever it is, keep to the
vocabulary the material itself uses — a reader should recognise every name.

**A code base (git repository).** The top level is the deployed system, not
the directory tree. Blocks: the services, apps, workers and packages that run
or ship separately; the external systems they talk to (databases, queues,
third-party APIs, the browser); the hardware they drive. Wires: the calls,
messages, queries and files between them, labelled with the protocol or the
message (`HTTPS`, `order.placed`, `Modbus TCP`). Drill into the one or two
services that matter most: their modules as child blocks, each with a `link`
to its source file on a stable URL (`blob/<branch>/path`). Read the entry
points, the dependency manifests, the deployment files (compose, Helm, CI),
the README — not every file.

**A folder of documents (Drive, SharePoint, a wiki).** Skim for the system
being described, then read the documents that define structure: architecture
notes, interface lists, wiring diagrams, BOMs, process descriptions, org
charts. Blocks: the machines, subsystems, departments or process steps. Wires:
the signals, materials, documents or approvals that move between them. Where
documents disagree, follow the most recent and say so in a `props` note.

**A description in the conversation.** Ask nothing you can decide yourself;
choose sensible components and name them plainly. Put anything you had to
assume in a `props` entry (`assumed: 48 V bus`) so the person can see it.

**A business process.** Blocks are steps or roles, coloured by the department
that owns them; wires are the documents and decisions that move between them
(`purchase order`, `released`, `on hold`); a decision with two outcomes is two
out ports. Nest a step to show its sub-steps.

Keep a level to roughly 5–12 blocks. If a level has more, group: the group
becomes a block with its own `blocks`. Prefer depth over a crowded picture.

---

## Layout

**You do not place anything.** A level whose blocks carry no `x`/`y` is laid
out when the file is opened:

- every block is sized to its text (title, subtitle, detail lines) and its
  pins, never smaller than the editor's default `120×80`, on the 40 px grid;
- blocks are arranged left to right along their wires: what feeds the level
  (blocks with nothing before them, or fed by the enclosing block's own
  inputs) in the left column, what it produces on the right, the most
  connected block anchoring the middle; a level's inputs face left and its
  outputs right;
- columns are three cells apart (room for a wire label and a detour), rows
  two cells apart, so a person can still drag things around afterwards;
- wires that run against the flow (feedback) leave and arrive by the bottom
  edge and run under the row; **dashed or dotted wires** (`dash: dashed`) are
  treated as secondary — a control bus, telemetry — and keep their blocks near
  each other without deciding the order;
- blocks wired to nothing (a caption, a note, a legend) go in a row above the
  diagram, then below it;
- nested levels are laid out first, bottom up, and a container's face grows
  until the level inside fits its frame, so nothing is clipped.

Wires route themselves orthogonally around blocks; crossings are allowed,
overlaps are not.

**Taking over.** Give any block at a level an `x` and `y` and you own that
whole level — nothing there moves, and blocks without `w`/`h` get the
defaults. Coordinates are multiples of 40; port `offset` is `20, 60, 100, …`
along the side. A `w`/`h` on an automatic level is a minimum. `layout: auto`
at the top of the document lays every level out again even when coordinates
are present (useful to renew a file after adding blocks by hand).

To see the coordinates the layout chose — to hand-edit them, or to commit a
fully placed file — run `node client/tools/layout.mjs diagram.yaml`: it
prints the same YAML with every `x`, `y`, `w`, `h` and `offset` filled in.

---

## How the person loads it

| Route | What happens |
| --- | --- |
| Menu → Open, pick a `.yaml` file | replaces the whole project, laid out |
| Select the YAML text, Ctrl/Cmd+V on the canvas | **adds** it to the level being viewed |
| `https://nodigraph.com/?github=owner/repo/path/to/diagram.yaml` | opens a file committed to a public GitHub repo, live |
| `https://nodigraph.com/#d=…` | the whole diagram inside the link (see Delivering) |
| Menu → Export → YAML, or Copy as YAML | gives this same format back out |

---

## The YAML dialect

The reader handles ordinary block mappings and sequences whose leaf values are
scalars or **single-line** flow mappings. It does **not** support anchors
(`&`/`*`), multiple documents (`---`), block scalars (`|`, `>`), or a value
spread over more than one line. `#` starts a comment.

Quote a value with `"…"` when it contains `,` `{` `}` `[` `]`, a `: ` (colon
followed by space), or starts with a YAML indicator character. Hex colours must
be quoted. `·`, `→`, `::`, `/`, `%`, `°` and `−` are all safe unquoted.

---

## Schema

### Top level

| Key | Meaning |
| --- | --- |
| `name` | the product's name |
| `blocks` | mapping of local id → block (**required**) |
| `wires` | sequence of wires between those blocks |
| `ports` | the product's *own* interface, same shape as a block's `ports` |
| `layout` | `auto` to lay every level out even where coordinates are present |
| `boundary` | `{ x, y, w, h }` of the frame the top level is drawn in. Leave it out with automatic layout; it is computed. |

### Block

| Key | Default | Notes |
| --- | --- | --- |
| `name` | `New Block` | the title. `name: ""` draws nothing. |
| `subtitle` | — | one smaller, muted line under the title |
| `lines` | — | a block sequence of short monospace detail rows under the title |
| `link` | — | an `http(s)` URL this block stands for — a source file on GitHub, an endpoint, a document. Draws an ↗ glyph; clicking it opens the URL. |
| `title_pos` | `center`, or `top` once `subtitle`/`lines` are set | `top`, `center`, `bottom` |
| `title_align` | `center` | `left`, `center`, `right` |
| `kind` | `block` | `text` = a bare label: no border, no fill, no ports. |
| `x`, `y` | automatic | top-left, multiples of 40. Leave out for automatic layout. |
| `w`, `h` | automatic (`120×80` on a hand-placed level) | multiples of 40; minimum 40. A minimum on an automatic level. |
| `color` | `#3b6fa0` | **border** colour. `transparent` for none. |
| `fill` | paper | background. `transparent` for none. |
| `font` | system | `inter`, `mono`, or `serif` |
| `size` | `13` | font size in px |
| `bold`, `italic` | `false` | `true` to set |
| `ports` | — | mapping of local id → port |
| `props` | — | `{ key: value }` free-form data, shown in the Inspector. Put sources, assumptions and notes here. |
| `blocks`, `wires`, `boundary` | — | this block's *interior* — see Nesting |

A block's name doubles as an image source: give it an `http(s)` URL ending in
`.png`/`.jpg`/`.svg` and the picture fills the block instead of the text.

### Port

| Key | Default | Notes |
| --- | --- | --- |
| `name` | — | drawn as a label beside the port, inside the block. Name the ports whose signal matters; leave the rest unlabelled. |
| `dir` | undecided | `in` or `out`. Leave it out for a two-way link (a bus, an Ethernet cable). |
| `side` | automatic (`left` for `in`, `right` for `out`) | `left`, `right`, `top`, `bottom`. Leave out; the layout turns a pin towards its wire. |
| `offset` | automatic | px from that side's start corner, `20 + 40n`. Leave out. |
| `desc` | — | free text |

A port is drawn as a socket cut into the block's border, and `dir` is its
shape: an `in` is a dent, an `out` a tab, an undecided port a ring. A wire
fills the socket it reaches with a plug in the wire's own colour, which is the
only arrow a wire has. One port may carry several wires (a fan-out); a
separate port per distinct signal reads better.

### Wire

```yaml
wires:
  - b1.p2 -> b2.p1
  - { from: b1.p2, to: b2.p1, label: 250 kbit, color: "#c2410c", dash: dashed }
```

`from` is where the flow starts. `dash` is `dashed` or `dotted` (omit for
solid); use it for control, telemetry and status paths, so they read as
secondary and are laid out as such. `self.pN` addresses the enclosing block's
own port. A label is drawn centred on the wire; keep it to a few words.

---

## Nesting

Give a block its own `blocks`/`wires` and it can be drilled into. Children
wire to the parent's own ports through `self`:

```yaml
  psu:
    name: Power supply
    ports:
      ac: { name: 230 V, dir: in }
      dc: { name: 48 V, dir: out }
    blocks:
      rectifier:
        name: Rectifier
        ports:
          ac: { dir: in }
          raw: { dir: out }
      regulator:
        name: Regulator
        subtitle: buck · 48 V · 20 A
        ports:
          raw: { dir: in }
          dc: { dir: out }
    wires:
      - self.ac -> rectifier.ac
      - rectifier.raw -> regulator.raw
      - regulator.dc -> self.dc
```

Child keys are scoped to their own level, so reusing `rectifier` in another
block is fine. Nest as deep as the material goes; three levels is common.

**The frame is a scaled picture of the block.** A level is drawn inside a
dashed frame that has the block's shape; `self` ports sit on the frame where
the block's own ports sit on its face. With automatic layout the frame is
computed (3× the face, or more for a big level) and the level is centred in
it — you never write `boundary`. When you place a level by hand, set
`boundary` to wrap your content, ideally 3× the block's `w`/`h`; a frame of a
different aspect ratio is grown to the block's on load.

Every level is drawn in place: zooming into a block draws its level on its
face, and its children can be selected and wired right there. Double-clicking
a container zooms the view to its level; the breadcrumb goes back up.

---

## Recipes

### A card with detail lines

A block carries its own text stack: `name` as title, an optional `subtitle`,
and `lines` — short monospace rows for what a system diagram needs to say (a
bus, a rate, a package, an address). Rows are never wrapped; keep them short.
The block is sized to hold them.

```yaml
  motion:
    name: Motion unit
    subtitle: Compute Node A
    lines:
      - motion_controller
      - 20 ms cycle
      - "3 frames / 20 ms"           # quote a row that has a `: ` or `#`
    fill: "#eaf4ec"
    color: "#4a8c5c"
    bold: true                        # applies to the title
    ports:
      cmd: { dir: in }
      joints: { dir: out }
```

### Colour by domain

Pick one border/fill pair per kind of thing and keep to it across the whole
diagram — sensors, compute, actuators, external systems; or sales, finance,
warehouse. Muted fills with a darker border of the same hue read best:

| Role | `color` | `fill` | deeper, for a child of that role |
| --- | --- | --- | --- |
| inputs / sensors | `"#247e91"` | `"#eaf7fa"` | `"#175a69"` / `"#d3ecf2"` |
| processing / software | `"#16836e"` | `"#e7f7ef"` | `"#0f5c4e"` / `"#cfeade"` |
| planning / logic | `"#8160af"` | `"#f3eefb"` | `"#5c417e"` / `"#e5daf5"` |
| actuation / power | `"#b47621"` | `"#fff5e5"` | `"#815316"` / `"#ffe9c7"` |
| safety / external / alerts | `"#c2410c"` | `"#fde8dd"` | `"#8c2f09"` / `"#f9d2bf"` |
| infrastructure / passive | `"#68798b"` | `"#f0f4f8"` | `"#4a5766"` / `"#dde5ed"` |
| people / clients / business | `"#4a6fa5"` | `"#e3eaf7"` | `"#344f76"` / `"#c9d7ec"` |

**A block never repeats its container's pair.** A level is drawn *on its
container's face*, so a child is inside that block's outline, not beside
it — give it the same colour and its own edge dissolves into the frame
around it, hiding the one thing the picture exists to show. Colour the
child by its own role where that differs from its container's; where it
genuinely is the same role — the cell modules inside a battery pack, the
PID terms inside a controller — take the deeper pair in the last column,
and alternate back to the base pair one level further down. The linter
reports this as `parent-colour`.

Give a `kind: text` block with a one-line legend when the colours carry
meaning (see `examples/order-to-cash.yaml`).

### A feedback path

Just wire it; the layout puts a wire that runs against the flow under the
row, and a colour makes it read as a return path:

```yaml
  - { from: sensor.pv, to: controller.pv, label: PV · feedback, color: "#16836e" }
```

### Secondary paths: control, telemetry, status

Draw them dashed. They are laid out as secondary — the blocks they join are
placed by the main flow — and they read as such:

```yaml
  - { from: ems.inverter, to: inverter.ctrl, label: P · Q setpoints, color: "#c2410c", dash: dashed }
```

### Artifacts: source files, endpoints, documents

A system diagram ends in things that are not blocks: the source file that
implements a driver, the endpoint a service exposes, the document that
specifies a protocol. Put them in as child blocks with a `link`, inside the
component they belong to, and wire them to what they implement or serve.
Point `link` at a permanent URL — a `blob/<branch>/path` on GitHub, an
OpenAPI page, a Drive file link — never at something that needs the reader's
session.

```yaml
  orders:
    name: Order service
    link: https://github.com/example/shop/tree/main/services/orders
    ports:
      http: { dir: in }
      db: { dir: out }
    blocks:
      router:
        name: routes/orders.ts
        subtitle: validation · auth scopes
        link: https://github.com/example/shop/blob/main/services/orders/src/routes/orders.ts
        ports:
          http: { dir: in }
          cmd: { dir: out }
      repo:
        name: repo/orders.ts
        subtitle: Postgres · transactional outbox
        link: https://github.com/example/shop/blob/main/services/orders/src/repo/orders.ts
        ports:
          cmd: { dir: in }
          sql: { dir: out }
    wires:
      - self.http -> router.http
      - router.cmd -> repo.cmd
      - repo.sql -> self.db
```

### Groups

Do not draw lanes or background panels on an automatic level; a panel is
just a big block that nothing is wired to, and it will be placed as one.
Group by nesting instead: the group is a block, its members are its children.
Hand-placed levels may still use an empty pale block listed first as a panel
(see `examples/card-layout.yaml`).

---

## Delivering the result

The person asked for a diagram; give them the thing they can open.

| They want | Give them |
| --- | --- |
| the diagram | the YAML in one code block, and a sentence on how to open it (Menu → Open, or paste onto the canvas) |
| a file in their repo | the YAML committed as `docs/<name>.yaml`; opens live at `https://nodigraph.com/?github=owner/repo/docs/<name>.yaml` (public repos, or with a token in the editor) |
| a link | `node client/tools/layout.mjs diagram.yaml --link` prints a `https://nodigraph.com/#d=…` link with the whole laid-out diagram inside it — nothing to host. About a hundred blocks fit. |
| JSON | `node client/tools/layout.mjs diagram.yaml --json` prints the full project JSON (what Download gives) |
| a picture | `node client/tools/svg.mjs diagram.yaml --out diagram.svg`, or `--all --out-dir figures` for every level |
| the coordinates | `node client/tools/layout.mjs diagram.yaml` prints the YAML with every position filled in |

These tools ship with nodigraph, not with the repository you are reading,
so clone it first — `git clone --depth 1
https://github.com/nodi-andy/nodigraph` — and prefix the paths above with
`nodigraph/` (Node 18+, installs nothing, no browser needed). Without
them, the YAML alone is a complete deliverable: the editor does the layout
on opening.

---

## Before you hand it over

Lint the file. It walks every level with the editor's own model and
routing and reports what a reader would trip over — a wire through a
block, blocks on top of each other, labels colliding. Exit code 1 means at
least one error.

**The linter is not in the repository you are reading.** It ships with
nodigraph, so fetch that first; it needs Node 18+ and installs nothing.

```
git clone --depth 1 https://github.com/nodi-andy/nodigraph
node nodigraph/client/tools/lint.mjs diagram.yaml [--json]
```

(From a checkout of nodigraph itself, that second line is
`node client/tools/lint.mjs diagram.yaml`.)

**Do not write your own checker.** A hand-rolled validator re-reads the
YAML you just wrote and confirms it says what you meant; this one lays the
diagram out and routes the wires exactly as the editor will, which is the
only way to find the problems that matter — and the ones it reports are
invisible to a schema check. If you cannot clone or cannot run commands,
walk the checklist below and say in your reply that the diagram is
unlinted.

Whether or not you can run it:

- [ ] `blocks` is a mapping; `wires` is a sequence; 2-space indentation; every `{ … }` on one line.
- [ ] Every hex colour quoted; no commas inside unquoted labels or names.
- [ ] Every wire endpoint names a block key and a port key that exist at that level (`self.x` names a port of the enclosing block).
- [ ] Wires point the way the thing flows; secondary paths are `dash: dashed`.
- [ ] No coordinates unless the person asked for a particular arrangement — and then every `x`/`y`/`w`/`h` a multiple of 40 and every `offset` one of `20, 60, 100, …`.
- [ ] No block wears its container's `color` or `fill` — a child is drawn inside that block, so it needs its own shade (see [Colour by domain](#colour-by-domain)).
- [ ] 5–12 blocks per level; more than that is a level to nest.
- [ ] Names, labels and detail lines use the source material's own terms; assumptions noted in `props`.
- [ ] Every `link` an `http(s)` URL to a stable location.

---

## Worked examples

All in [`examples/`](examples/), all written without coordinates, all
lint-clean. Open any of them at
`https://nodigraph.com/?github=nodi-andy/nodigraph/docs/examples/<file>`.

| File | Field | Shows |
| --- | --- | --- |
| [`mobile-robot.yaml`](examples/mobile-robot.yaml) | robotics / mechatronics | sensors → perception → planning → control → drives, three levels deep, a safety path, dashed telemetry |
| [`battery-storage.yaml`](examples/battery-storage.yaml) | electrical / power | PV, battery with BMS inside, inverter inside, grid; a dashed Modbus control layer |
| [`saas-platform.yaml`](examples/saas-platform.yaml) | software | clients, gateway, services, stores, external APIs; one service drilled into its source files with `link`s |
| [`hvac-control.yaml`](examples/hvac-control.yaml) | process / control | a closed loop with the PID controller drilled into its terms, a feedback wire |
| [`safety-cell.yaml`](examples/safety-cell.yaml) | machine safety | dual-channel inputs, safety PLC internals, contactors, STO; safety path in red |
| [`order-to-cash.yaml`](examples/order-to-cash.yaml) | business process | steps by department, documents as wires, fulfilment drilled into pick/pack/ship |
| [`local-ai.yaml`](examples/local-ai.yaml) | software (hand-placed) | the README walkthrough, three levels, every coordinate written by hand |
| [`card-layout.yaml`](examples/card-layout.yaml) | — (hand-placed) | `subtitle`, `lines`, `title_pos`, `title_align`, a panel |
