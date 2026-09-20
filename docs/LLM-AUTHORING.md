# Authoring nodigraph diagrams (for an LLM)

You are writing **one YAML document** that a person will load into
[nodigraph](https://nodigraph.com) and then keep editing by hand. Emit the
YAML and nothing else — no PNG, no SVG, no Mermaid. Everything below is the
format the editor itself exports, so anything you write here round-trips.

---

## Cheat sheet

If you read only one section, read this one.

```yaml
name: My System                       # the product / top level
boundary: { x: 0, y: 0, w: 1200, h: 600 }   # dashed frame around the top level
blocks:                               # a mapping, NOT a list. Key = local id.
  b1:                                 # first key = drawn furthest back
    name: Probe Array
    subtitle: 3 lidars · cameras      # optional smaller line under the title
    lines:                            # optional monospace detail rows
      - 192.0.2.20..23
    x: 80                             # multiples of 40 (the grid)
    y: 80
    w: 200                            # default 120
    h: 120                            # default 80
    color: "#4a8c5c"                  # BORDER colour
    fill: "#eaf4ec"                   # background
    ports:
      p1: { dir: in,  offset: 60 }    # offset must be 20, 60, 100, 140, ...
      p2: { dir: out, offset: 60 }
  b2:
    name: MCU
    x: 480
    y: 80
    w: 200
    h: 120
    ports:
      p1: { dir: in, offset: 60 }
wires:
  - b1.p2 -> b2.p1                              # plain
  - { from: b1.p2, to: b2.p1, label: 5V rail }  # with a label
```

Six rules that cause almost every mistake:

1. **`blocks` is a mapping keyed by id**, not a sequence. `wires` *is* a sequence.
2. **Indent exactly 2 spaces per level.** The reader is a small purpose-built
   parser, not a full YAML implementation.
3. **`offset` must be a cell centre**: `20, 60, 100, 140, …`. Anything else is
   snapped and your wires stop lining up.
4. **`color` is the border, `fill` is the background.** There is no text-colour
   field. A `kind: text` block given a `color` grows a visible box around itself.
5. **Never put a comma inside an unquoted value** — it splits a `{ … }` record.
6. **A `{ … }` record cannot contain another `{ … }`.** One level of flow only:
   `p1: { dir: in, offset: 60 }` is fine, `b1: { name: X, ports: { … } }` silently
   turns the inner record into a meaningless string. Write blocks in block style
   and keep flow style for ports and wires.

---

## How the human loads it

| Route | What happens |
| --- | --- |
| Menu → Open, pick a `.yaml` file | replaces the whole project |
| Select the YAML text, Ctrl/Cmd+V on the canvas | **adds** it to the level being viewed |
| Menu → Export → YAML, or Copy as YAML | gives this same format back out |

Pasting is usually what you want: it drops your blocks into an open diagram
without destroying what is already there.

---

## The YAML dialect

The reader handles ordinary block mappings and sequences whose leaf values are
scalars or **single-line** flow mappings. It does **not** support anchors
(`&`/`*`), multiple documents (`---`), block scalars (`|`, `>`), or a value
spread over more than one line. `#` starts a comment.

Quote a value with `"…"` when it contains `,` `{` `}` `[` `]`, a `: ` (colon
followed by space), or starts with a YAML indicator character. Hex colours must
be quoted, because `#` would otherwise start a comment. `·`, `→`, `::` and `/`
are all safe unquoted.

---

## Schema

### Top level

| Key | Meaning |
| --- | --- |
| `name` | the product's name |
| `blocks` | mapping of local id → block (**required**) |
| `wires` | sequence of wires between those blocks |
| `ports` | the product's *own* interface, same shape as a block's `ports` |
| `boundary` | `{ x, y, w, h }` of the frame the block's interior is laid out in. Default: the block's own size × 3 at the origin (the top level: `{0,0,360,240}`) — set it to wrap your content. It is grown to the block's aspect ratio on load, never shrunk, so 3× the block's `w`/`h` is the tidy choice; see Nesting. |

### Block

| Key | Default | Notes |
| --- | --- | --- |
| `name` | `New Block` | the title. `name: ""` draws nothing — use it for panels. |
| `subtitle` | — | one smaller, muted line under the title |
| `lines` | — | a block sequence of short monospace detail rows under the title (see the card recipe) |
| `link` | — | an `http(s)` URL this block stands for — a source file on GitHub, an endpoint. Draws an ↗ glyph in the corner; clicking it (or double-clicking a link block without an interior) opens the URL in a new tab. See Artifacts. |
| `title_pos` | `center`, or `top` once `subtitle`/`lines` are set | `top`, `center`, `bottom` — where the text stack sits |
| `title_align` | `center` | `left`, `center`, `right` — how every row aligns |
| `kind` | `block` | `text` = a bare label: no border, no fill, no ports. |
| `x`, `y` | `0` | top-left, multiples of 40 |
| `w`, `h` | `120`×`80` (text: `160`×`40`) | multiples of 40; minimum 40 |
| `color` | `#3b6fa0` | **border** colour. `transparent` for none. |
| `fill` | theme paper | background. `transparent` for none. |
| `font` | system | `inter`, `mono`, or `serif` |
| `size` | `13` | font size in px |
| `bold`, `italic` | `false` | `true` to set |
| `ports` | — | mapping of local id → port |
| `props` | — | `{ key: value }` free-form data, shown in the Inspector |
| `blocks`, `wires`, `boundary` | — | this block's *interior* — see Nesting |

A block's name doubles as an image source: give it an `http(s)` URL ending in
`.png`/`.jpg`/`.svg`/… and the picture fills the block instead of the text.

### Port

| Key | Default | Notes |
| --- | --- | --- |
| `name` | — | drawn as a label beside the port. **Omit it for an unlabelled connector** — that is what you usually want on a dense diagram. |
| `dir` | undecided | `in` or `out` |
| `side` | `left` for `in`, `right` for `out` | `left`, `right`, `top`, `bottom` |
| `offset` | auto | px from that side's start corner (top for left/right, left for top/bottom). **Must be `20 + 40n`.** |
| `desc` | — | free text |

A port is drawn as a socket cut into the block's border, and `dir` is its
shape: an `in` is a trapezoid dent into the block, an `out` the same trapezoid
as a tab out of it, an undecided port a ring on the border. A wire fills the
socket it reaches with a plug in the wire's own colour, so a wired pin reads as
plugged and an unwired one as an empty socket; the plug narrows the way the
data flows, which is the only arrow a wire has. Leave `dir` out for a two-way
link (a bus, an Ethernet cable): a ring never points anywhere.

Two blocks can also be plugged straight together, with no wire between them:
put them edge to edge so an `out` pin and an `in` pin sit on the same point of
the shared border, and declare the connection as usual. The tab then sits in
the dent and no wire is drawn. Placement alone never connects anything — the
connection still has to be in the file — but a declared connection between two
pins that meet this way always draws as a plug.

A side of length `L` has `floor(L / 40)` slots at `20, 60, 100, …`. So an
`h: 120` block has `20 / 60 / 100`, and `60` is its vertical middle — give every
card in a row the same height and the same offset and all the wires run dead
straight.

### Wire

```yaml
wires:
  - b1.p2 -> b2.p1
  - { from: b1.p2, to: b2.p1, label: 250 kbit, color: "#c2410c", dash: dashed }
```

`dash` is `dashed` or `dotted` (omit for solid). `self.pN` addresses the
enclosing block's own port. A wire label is drawn **centred on the wire**, so
leave a gap between the two blocks of roughly `8px × the label's length` or it
will overlap them.

---

## Layout rules

- The grid is **40px**. Keep every `x`, `y`, `w`, `h` on a multiple of it.
- **Order in `blocks` is z-order.** The first key is drawn furthest back. List
  background panels before the things that sit on them.
- Wires route themselves orthogonally; you do not place bends. Parallel wires
  between the same two rows fan out into separate channels on their own, a
  wire to a `self` pin keeps clear of the band along the frame, and a wire
  whose straight route would run through a block is routed around it (and
  around the wires already routed around that block). A lane or panel a pin
  sits inside is not an obstacle. Leaving a free lane still gives the shortest
  wires.
- Nothing auto-layouts. You are responsible for every coordinate, so work out
  your column and row positions before you start emitting.

---

## Recipes

### A card with detail lines under its title

A block carries its own text stack: the `name` as title, an optional
`subtitle`, and `lines` — short monospace rows for the things a system
diagram actually needs to say (a bus, a rate, a package). Rows are squeezed
to the block width, never wrapped, so keep them short and size the block to
hold them: title + subtitle + three lines need about `h: 120`.

```yaml
  b1:
    name: Motion unit
    subtitle: Compute Node A
    lines:
      - motion_controller
      - 20 ms cycle
      - "3 frames / 20 ms"           # quote a row that has a `: ` or `#`
    x: 560
    y: 240
    w: 200
    h: 120
    fill: "#eaf4ec"
    color: "#4a8c5c"
    bold: true                        # applies to the title
    title_align: left                 # optional; default centred
    ports:
      p1: { dir: in,  offset: 60 }
      p2: { dir: out, offset: 60 }
```

`title_pos` moves the stack (`top` is the default as soon as a subtitle or
lines exist; a bare `name` stays centred as before). The older way — an
empty block as the card plus stacked `kind: text` blocks — still loads, but
those text blocks do not move with the card and fight the sub-architecture
miniature a container draws on its face, so prefer the fields above.

### A lane / group panel

A big, empty, pale block listed **before** its contents, plus a text block for
the lane title:

```yaml
  b1:
    name: ""
    x: 520
    y: 80
    w: 1480
    h: 520
    fill: "#f7f8fa"
    color: "#ccd2dc"
  b2:
    name: COMPUTE NODE A · 192.0.2.10
    kind: text
    x: 540
    y: 100
    w: 520
    bold: true
    size: 11
```

Text is centred in its own box, so size the box to control where the title
appears.

### A feedback path that runs back around

Give the source a `bottom` port and the destination a `bottom` port; the router
takes it under the row. Colour it so it reads as a return path:

```yaml
  - { from: b46.p2, to: b26.p3, label: status · back over the same hops, color: "#c2410c" }
```

### A sub-system you can drill into

Give a block its own `blocks`/`wires`/`boundary`. Children wire to the parent's
own ports through `self`:

```yaml
  b1:
    name: Power Supply
    x: 80
    y: 80
    w: 240
    h: 160
    ports:
      p1: { name: 5V, dir: out, offset: 60 }
    boundary: { x: 0, y: 0, w: 520, h: 280 }
    blocks:
      c1:
        name: Rectifier
        x: 40
        y: 40
        ports:
          q1: { dir: out, offset: 20 }
      c2:
        name: Regulator
        x: 280
        y: 40
        ports:
          q1: { dir: in,  offset: 20 }
          q2: { dir: out, offset: 20 }
    wires:
      - c1.q1 -> c2.q1
      - c2.q2 -> self.p1
```

Child keys are scoped to their own level, so reusing `c1` in another block is
fine.

**The frame is a scaled picture of the block.** `self` ports sit on the frame
exactly where the block's own ports sit on its face — same side, same
proportional position. You do not place them separately (an older
`inSide`/`inOffset` on a port is read and ignored). A frame whose aspect ratio
differs from the block's is grown to match on load, so its edges always
coincide with the block's. To wire a child straight to a `self` port, put the
child's port at k× the parent port's offset when the frame is k× the block: a
parent pin at `offset: 60` on the top edge is at `x: 180` inside a 3× frame.
Odd multiples (3×, 5×) put those points on the child grid's own slots.

Every level is drawn in place: zooming into a block draws its level on its
face through that same mapping as soon as its contents reach half size on
screen (so a snug frame, 3× the block, opens much earlier than a sprawling one),
and its children can then be selected, dragged and wired right there — the
click decides which level it edits, nothing on screen changes. The block's
pin labels move out beside the pins while its level is shown, so they never
sit where the level's wires reach the frame. A `self` pin
that carries several wires inside shows one sub-slot per wire on the frame:
one plug outside, its individual pins inside. Grabbing a
container's empty space still moves the container as a whole until it fills
the view. Double-clicking a container zooms the view to its level; the
breadcrumb goes back up.

### Artifacts: source files, endpoints, documents

A system diagram ends in things that are not blocks: the source file that
implements a driver, the endpoint a service exposes, the document that
specifies a protocol. Put them in as child blocks with a `link`, inside the
component they belong to, and wire them to what they implement or serve:

```yaml
  hub:
    name: Safety Hub
    x: 400
    y: 80
    w: 240
    h: 160
    boundary: { x: 0, y: 0, w: 720, h: 480 }
    blocks:
      plc:
        name: PLC program
        subtitle: CODESYS · IEC 61131-3
        x: 80
        y: 80
        w: 200
        h: 120
        ports:
          out: { name: CAN2, dir: out, offset: 60 }
      code:
        name: code.st
        subtitle: cyclic task · 10 ms
        link: https://github.com/org/repo/blob/main/plc/code.st
        x: 400
        y: 40
        w: 200
        h: 80
        color: "#6b7280"
      header:
        name: header.st
        subtitle: types · globals
        link: https://github.com/org/repo/blob/main/plc/header.st
        x: 400
        y: 160
        w: 200
        h: 80
        color: "#6b7280"
```

A link block renders as any other block plus the ↗ glyph, so it can carry a
`subtitle` and `lines` (the file's role, the message it publishes, its rate)
and ports. Point `link` at a permanent URL — a `blob/<branch>/path` on GitHub,
an OpenAPI page — never at something that needs the reader's session.

---

## Before you emit, check

Run the lint on the file: it walks every level with the editor's own model
and routing and reports, as text or `--json`, what a reader would trip over —
a wire through a block, blocks on top of each other, a pin off its slots,
labels colliding, wires lying on one line, a frame that is not the block's
shape. Exit code 1 means at least one error.

```
node client/tools/lint.mjs diagram.yaml [--json]
```

- [ ] `blocks` is a mapping; `wires` is a sequence.
- [ ] 2-space indentation throughout; every `{ … }` on one line.
- [ ] Every hex colour quoted.
- [ ] No commas inside unquoted labels or names.
- [ ] Every `x`/`y`/`w`/`h` a multiple of 40.
- [ ] Every `offset` one of `20, 60, 100, 140, …` **and** less than that side's length.
- [ ] Every `wires` endpoint names a block key and a port key that exist at that level.
- [ ] Background panels listed before what sits on them.
- [ ] Gaps between wired blocks wide enough for their labels.
- [ ] `boundary` set to wrap the content, ideally 3× the block's `w`/`h`.
- [ ] Every `link` an `http(s)` URL to a stable location (`blob/<branch>/…`, not a session-bound viewer).

---

## Full worked example

[`examples/pipeline-lanes.yaml`](examples/pipeline-lanes.yaml) is a complete
lane-and-cards system diagram — five lanes, ten cards with monospace detail
lines, labelled wires between them, and a coloured feedback path running back
underneath. Copy its structure when you are asked for anything of that shape.
