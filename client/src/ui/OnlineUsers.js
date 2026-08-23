import { colorForClientId } from '../render/SceneRenderer.js';

// A small avatar row for who else is here right now, top-right in the
// header — reuses the same per-client color a remote cursor is already
// drawn in (see SceneRenderer.js), so telling whose cursor is whose is a
// glance, not a guess. There's no accounts system to draw a real name
// from (see main.js's own clientId comment), so a person is a color plus
// the same short id fragment their cursor's own label already shows.
//
// Hidden entirely while editing solo: an empty "who's online" row is
// just noise for the overwhelmingly common case of one person working
// alone, and the header's session button/badge already covers "is a
// session even running" on its own.
export function mountOnlineUsers(container) {
  container.className = 'online-users';

  function avatar(clientId, isSelf) {
    const el = document.createElement('div');
    el.className = 'online-avatar' + (isSelf ? ' online-avatar-self' : '');
    el.style.background = colorForClientId(clientId);
    el.textContent = clientId.slice(0, 2).toUpperCase();
    el.title = isSelf ? 'You' : `Collaborator ${clientId.slice(0, 4)}`;
    return el;
  }

  // Compared before touching the DOM, the same "no-op unless it actually
  // changed" rule every other per-frame refresh in this app follows —
  // this is called from the render loop, so a rebuild on every unchanged
  // frame would be pure churn.
  let lastKey = null;

  return {
    // `selfId` is this browser's own clientId; `peerIds` is whichever
    // remote cursors are still active (see main.js's pruneStaleCursors) —
    // the same "recently seen" list the canvas itself uses to draw or
    // fade out a cursor, so this reflects exactly who you'd actually see
    // moving something right now, not everyone who was ever in the
    // session.
    refresh(selfId, peerIds) {
      const key = peerIds.slice().sort().join(',');
      if (key === lastKey) return;
      lastKey = key;
      container.innerHTML = '';
      container.hidden = peerIds.length === 0;
      if (!peerIds.length) return;
      container.appendChild(avatar(selfId, true));
      for (const id of peerIds) container.appendChild(avatar(id, false));
    },
  };
}
