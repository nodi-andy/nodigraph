// Reads and writes a diagram straight to a file in a GitHub repo, using the
// Contents API directly from the browser — no server of nodigraph's own in
// the loop. Auth is a Personal Access Token, kept client-side only (see
// getStoredToken/setStoredToken) and sent only to api.github.com, the same
// "your credential never touches our infrastructure" posture the Google
// OAuth client id in config.js already documents for Docs export.
//
// A fast-follow could swap this for GitHub's OAuth Device Flow so nobody
// has to mint a token by hand, but that needs a registered OAuth App (an
// external setup step) and its token-exchange endpoint's CORS support is
// unconfirmed — a PAT works today against api.github.com with nothing to
// register.
const API = 'https://api.github.com';
const TOKEN_KEY = 'nodigraph:githubToken';

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can legitimately be unavailable (private browsing, quota) —
    // the token still works for the rest of this session's calls, it just
    // won't be remembered next time.
  }
}

// Accepts the shorthand this feature's own links use ("owner/repo/path/to/
// file.json") or a full github.com blob URL someone pasted from the repo's
// own UI ("https://github.com/owner/repo/blob/main/path/to/file.json").
export function parseGitHubTarget(input, ref) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  const blobMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (blobMatch) {
    const [, owner, repo, branch, path] = blobMatch;
    return { owner, repo, path, ref: branch };
  }

  const parts = trimmed.replace(/^\/+/, '').split('/');
  if (parts.length < 3) return null;
  const [owner, repo, ...rest] = parts;
  return { owner, repo, path: rest.join('/'), ref: ref || undefined };
}

export function formatGitHubTarget(target) {
  return `${target.owner}/${target.repo}/${target.path}`;
}

function authedHeaders(token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `token ${token}`;
  return headers;
}

async function apiFetch(url, options, token) {
  const res = await fetch(url, {
    ...options,
    // Every call here reads or acts on whatever is *currently* in the
    // repo — most importantly the sha a PUT conditions its write on (see
    // currentSha below). The browser's default HTTP cache doesn't know
    // that a GET made moments ago is now stale because this same tab just
    // wrote a new commit, so without this a save can silently PUT against
    // a sha from before its own previous save, or "Open from GitHub" can
    // hand back a diagram from before the last edit.
    cache: 'no-store',
    headers: { ...authedHeaders(token), ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new Error(body?.message || `GitHub API error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// The bare Contents API URL for a target — what a PUT (create/update) hits.
// GET-vs-PUT diverge here: a GET wants ?ref=branch to read a specific
// branch, but PUT takes a `branch` field in its JSON body instead — passing
// ?ref= on a PUT is simply ignored by GitHub, so the two need separate
// builders rather than one shared "add ref if present" helper.
function contentsPath({ owner, repo, path }) {
  return `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function contentsUrlForRead(target) {
  const base = contentsPath(target);
  return target.ref ? `${base}?ref=${encodeURIComponent(target.ref)}` : base;
}

// atob/btoa only handle Latin1 — wrapping with TextEncoder/TextDecoder
// keeps arbitrary Unicode in a block name or description intact. Built up
// in chunks rather than one `String.fromCharCode(...bytes)` spread: passing
// the whole byte array as individual arguments blows a JS engine's call
// stack once it's big enough, and a rendered SVG (verbose path/text markup)
// crosses that line far sooner than the JSON it sits next to — which
// otherwise fails silently only for the picture, on some diagrams and some
// browsers, while the JSON write beside it keeps working fine.
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

export async function readDiagramFromGitHub(target, token = getStoredToken()) {
  const file = await apiFetch(contentsUrlForRead(target), {}, token);
  if (Array.isArray(file)) throw new Error(`${target.path} is a directory, not a file`);
  const text = base64ToUtf8(file.content.replace(/\n/g, ''));
  const data = JSON.parse(text);
  if (!data?.rootBlock) throw new Error('Not a nodigraph project file');
  return data;
}

// foo.nodigraph.json -> foo.svg, matching the docs/architecture.* dogfooding
// convention — regenerated on every save rather than tracked separately, so
// there's no second path to configure or forget to update.
export function siblingSvgPath(jsonPath) {
  return jsonPath.replace(/\.nodigraph\.json$/i, '.svg').replace(/\.json$/i, '.svg');
}

async function currentSha(target, token) {
  try {
    const file = await apiFetch(contentsUrlForRead(target), {}, token);
    return Array.isArray(file) ? null : file.sha;
  } catch (err) {
    if (err.status === 404) return null; // Doesn't exist yet — a new file.
    throw err;
  }
}

async function putFile(target, content, message, token) {
  const sha = await currentSha(target, token);
  await apiFetch(
    contentsPath(target),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: utf8ToBase64(content),
        sha: sha || undefined,
        branch: target.ref || undefined,
      }),
    },
    token,
  );
}

// Writes the JSON source and its sibling SVG in one call — always a true
// update-in-place (PUT with the file's current sha), never an append, so a
// repeat save just overwrites both files rather than accumulating history
// of its own; git already keeps that history.
export async function writeDiagramToGitHub(target, projectData, svgString, token = getStoredToken()) {
  const jsonText = JSON.stringify(projectData, null, 2);
  const message = `Update ${target.path} (via nodigraph)`;
  await putFile(target, jsonText, message, token);
  // A failure here is a different, more confusing situation than either
  // file failing on its own: the diagram's source already committed, so
  // whatever caused this needs its own message rather than reading as if
  // nothing was saved at all.
  try {
    await putFile({ ...target, path: siblingSvgPath(target.path) }, svgString, message, token);
  } catch (err) {
    err.message = `Saved ${target.path}, but the picture didn't update: ${err.message}`;
    // Lets a caller tell this apart from a wholesale failure — the token
    // and target are proven good (the JSON write above used them
    // successfully), so there's no need to ask for either again.
    err.partialSuccess = true;
    throw err;
  }
}
