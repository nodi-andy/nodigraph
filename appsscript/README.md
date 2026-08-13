# Doc sync setup

This makes a single Google Doc the durable source of truth for a
gravis-sysml project — a generated, always-current description with
diagrams, backed by the exact structured data (blocks/ports/connections)
that produced them, all in one file. Nothing here needs a Google Cloud
project, OAuth client, or service account — only a Doc you already have
edit access to.

While you're editing in the app, nothing talks to Google — that stays
exactly as fast and local as it's always been. Only pressing **Save**
reaches the Doc, and only if the Doc hasn't changed since you last loaded
it (otherwise you're asked to pick a side, see below).

## One-time setup

1. **Create a new Google Doc** (anywhere in your Drive). Leave it empty —
   its contents get wiped and rebuilt on every Save, both the readable
   description/diagrams and a "Raw Data" appendix the app reads back on
   Load.
2. Open **Extensions → Apps Script**. Delete whatever's in the default
   `Code.gs` and paste in the contents of this folder's `Code.gs`. Nothing
   to fill in — the script is bound to this Doc directly, so it always
   knows which document it's reading and writing.
3. **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**.
   Who has access: **Anyone with the link** (or restrict to your Workspace
   domain if you'd rather keep it internal — either works with the app).
4. Click **Deploy**. The first time, Google will ask you to authorize the
   script — this is the one-time "allow" click mentioned above, tied to
   your own account, not a new app registration.
5. Copy the **Web app URL** it gives you.
6. In gravis-sysml, click the **⚙** button next to Save (top right) and
   paste that URL in.

That's it — **Save** now regenerates the Doc, and the app will load from
it the next time it starts.

## If two people save around the same time

Whoever saves second gets a prompt: *"Doc changed since you loaded it"*,
with two choices — **keep mine** (overwrite what the other person just
saved) or **take theirs** (discard your local changes and reload). There's
no automatic merge; pick the side you actually want.

## Re-running setup after changing `Code.gs`

Editing the script doesn't need a new deployment for most changes — from
the Apps Script editor, **Deploy → Manage deployments → edit (pencil) →
Version: New version → Deploy** keeps the same Web app URL. You only need
a brand new deployment (and to reconfigure the URL in the app) if you
delete the deployment entirely.
