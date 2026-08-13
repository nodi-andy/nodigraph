# Doc sync setup

This publishes a block's description + diagram into a Google Doc, exactly
where you put it — the Doc stays yours to write freely; the tool only ever
touches content you've explicitly marked. Nothing here needs a Google
Cloud project, OAuth client, or service account — only a Doc you already
have edit access to.

While you're editing in the app, nothing talks to Google — that stays
exactly as fast and local as it's always been. Only pressing **Update Doc**
reaches Google, and only the regions you've placed change; everything else
you've written is never touched.

## One-time setup

1. **Create a new Google Doc** (or use one you already write in).
2. Open **Extensions → Apps Script**. Delete whatever's in the default
   `Code.gs` and paste in the contents of this folder's `Code.gs`. Nothing
   to fill in — the script is bound to this Doc directly.
3. **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**.
   Who has access: **Anyone with the link** (or restrict to your Workspace
   domain if you'd rather keep it internal — either works with the app).
4. Click **Deploy**. The first time, Google will ask you to authorize the
   script — this is a one-time "allow" click tied to your own account, not
   a new app registration.
5. Copy the **Web app URL** it gives you.
6. In gravis-sysml, click the **⚙** button next to Update Doc (top right)
   and paste that URL in.

## Placing a region

Write whatever you want in the Doc. Wherever you want a specific block's
description + diagram to live, select that block in gravis-sysml's
Inspector and click **Copy Doc region**, then paste. You'll get something
like:

```
[gravis-sysml:begin id=blk_msr7njhj1]
Block: GRAVIS

input.Upper Structure:
input.HMI A/D/CAN:
input.ECU A/D/CAN:

{diagram}
[gravis-sysml:end id=blk_msr7njhj1]
```

The `id=...` is the block's real internal id — there's no way to type that
by hand correctly, which is why it has to come from the Copy button rather
than being typed from scratch. You can rearrange, indent, or surround this
with as much of your own writing as you like; only the text strictly
between the `begin`/`end` lines ever changes.

Clicking **Update Doc** re-renders the diagram and refreshes the
description for every region it finds a match for, in place. A block with
no region pasted anywhere in the Doc is just skipped — nothing gets
auto-inserted. If a region's markers ever get separated (e.g. one gets
deleted by hand), that region is treated the same as missing and skipped
rather than guessed at.

## Re-running setup after changing `Code.gs`

Editing the script doesn't need a new deployment for most changes — from
the Apps Script editor, **Deploy → Manage deployments → edit (pencil) →
Version: New version → Deploy** keeps the same Web app URL. You only need
a brand new deployment (and to reconfigure the URL in the app) if you
delete the deployment entirely.
