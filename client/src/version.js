// Which build of nodigraph this page is running, printed once to the
// browser console on load — so after a push you can open the deployed site
// and see at a glance whether the new build has actually gone out.
//
// The server answers /api/version (see server/src/app.js): the commit the
// image was built from, when it was built, and on Cloud Run the revision it
// is running as. A page not served by that server — opened from a file,
// or behind some other static host — has no such endpoint and simply
// prints nothing.
const VERSION_URL = '/api/version';

export async function logBuildVersion() {
  let info;
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    info = await res.json();
  } catch {
    return null;
  }
  const commit = info.commit && info.commit !== 'unknown' ? info.commit.slice(0, 7) : 'commit unknown';
  const parts = [commit];
  if (info.builtAt) parts.push(`built ${info.builtAt}`);
  if (info.revision) parts.push(`revision ${info.revision}`);
  console.info(`%cnodigraph%c ${parts.join(' · ')}`, 'font-weight:bold;color:#2f6fed', 'color:inherit');
  return info;
}
