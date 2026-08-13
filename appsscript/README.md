# Sheets/Docs sync setup

This makes a Google Sheet the durable source of truth for a gravis-sysml
project, with a companion Google Doc that always shows a generated,
up-to-date description + diagrams. Nothing here needs a Google Cloud
project, OAuth client, or service account — only a Sheet and a Doc you
already have edit access to.

While you're editing in the app, nothing talks to Google — that stays
exactly as fast and local as it's always been. Only pressing **Save**
reaches the Sheet, and only if the Sheet hasn't changed since you last
loaded it (otherwise you're asked to pick a side, see below).

## One-time setup

1. **Create a Drive folder** for the project (or reuse an existing one).
2. Inside it, **create a new Google Sheet**. This holds the structured
   data — you don't need to set up any tabs by hand, the script creates
   `Blocks`, `Ports`, `Connections`, and `Meta` itself the first time it
   runs.
3. Inside the same folder, **create a new Google Doc**. This is what gets
   regenerated on every Save — leave it empty, its contents will be wiped
   and rebuilt.
4. Open the Doc's URL and copy the id out of it:
   `docs.google.com/document/d/`**`THIS_PART`**`/edit`.
5. In the Sheet, open **Extensions → Apps Script**. Delete whatever's in
   the default `Code.gs` and paste in the contents of this folder's
   `Code.gs`.
6. Near the top of the pasted script, set `DOC_ID` to the id you copied in
   step 4.
7. **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**.
   Who has access: **Anyone with the link** (or restrict to your Workspace
   domain if you'd rather keep it internal — either works with the app).
8. Click **Deploy**. The first time, Google will ask you to authorize the
   script — this is the one-time "allow" click mentioned above, tied to
   your own account, not a new app registration.
9. Copy the **Web app URL** it gives you.
10. In gravis-sysml, click the **⚙** button next to Save (top right) and
    paste that URL in.

That's it — **Save** now pushes to the Sheet and regenerates the Doc, and
the app will load from the Sheet the next time it starts.

## If two people save around the same time

Whoever saves second gets a prompt: *"Sheet changed since you loaded it"*,
with two choices — **keep mine** (overwrite what the other person just
saved) or **take theirs** (discard your local changes and reload). There's
no automatic merge; pick the side you actually want.

## Re-running setup after changing `Code.gs`

Editing the script doesn't need a new deployment for most changes — from
the Apps Script editor, **Deploy → Manage deployments → edit (pencil) →
Version: New version → Deploy** keeps the same Web app URL. You only need
a brand new deployment (and to reconfigure the URL in the app) if you
delete the deployment entirely.
