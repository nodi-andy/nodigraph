# gravis-sysml

Browser-based visual editor for product specification: define a product, its interfaces, requirements, and architecture, with components recursively decomposed the same way. Blocks render as a fixed Input / Processing / Output region layout, ports live on the border, and connections between output and input ports animate to show data flow. Data is stored as plain JSON files versioned with git, not tied to formal OMG SysML.

See the build plan for full architecture and the milestone roadmap.

## Milestone 1 — Canvas MVP (current)

Client-only, no server/auth yet. Pan/zoom an infinite canvas, add/move/resize blocks, each block renders its Input/Processing/Output regions. State persists to `localStorage`.

### Run it

```bash
node client/dev-server.js
```

Then open the printed URL (default `http://localhost:8080`).
