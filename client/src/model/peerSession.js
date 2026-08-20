// Live collaboration over WebRTC data channels (PeerJS), as an alternative
// to the WebSocket sync in liveSync.js. Two reasons it earns its place:
//
//   - Diagram data never touches a server. The PeerJS broker is used only
//     to swap connection details (SDP/ICE); once the data channel is open
//     every edit travels directly between browsers. That keeps the "we
//     store nothing" promise true even while collaborating.
//   - The WebSocket path only syncs clients hooked to the *same* server
//     process, which stops being true the moment the host autoscales to a
//     second instance. Peer connections don't care where anyone is served
//     from.
//
// Topology is a star, not a mesh: guests connect to the host, and the host
// relays each message on to the others. A mesh would need every peer to
// learn about every other one, for no benefit at the handful-of-people
// scale this is meant for.
//
// The messages are exactly the ones liveSync already speaks ('project'
// snapshots and ephemeral 'live' updates), so main.js handles a peer
// message and a WebSocket message through the same code.
const PEERJS_SRC = 'vendor/peerjs.min.js';

// Vendored rather than pulled from a CDN so the app stays self-contained
// and self-hostable, and loaded only when a session actually starts — the
// single-user case shouldn't pay for 87KB it never uses.
let libraryPromise = null;
function loadPeerLibrary() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PEERJS_SRC;
      script.async = true;
      script.onload = () => resolve(window.Peer);
      script.onerror = () => {
        // Cleared so a later attempt can retry rather than being stuck
        // with a permanently rejected promise.
        libraryPromise = null;
        reject(new Error('Could not load the collaboration library'));
      };
      document.head.appendChild(script);
    });
  }
  return libraryPromise;
}

/**
 * `onMessage(message)` receives decoded messages from any peer.
 * `onStatus({ state, role, sessionId, peers, error })` fires whenever the
 * session changes, so the UI can show what's going on.
 */
export function createPeerSession({ onMessage, onStatus }) {
  let peer = null;
  let role = null; // 'host' | 'guest'
  let sessionId = null;
  let state = 'idle'; // idle | connecting | live | error
  const connections = new Map();

  function emit(error) {
    onStatus?.({ state, role, sessionId, peers: connections.size, error });
  }

  // PeerJS errors often carry a machine-readable `type` ('network',
  // 'peer-unavailable', 'browser-incompatible', ...) and an empty message,
  // so falling back to the type is the difference between a useful report
  // and a blank one.
  function describe(err) {
    if (!err) return 'Unknown error';
    const detail = err.message || err.type || String(err);
    if (err.type === 'network') return 'Could not reach the session broker (network blocked?)';
    if (err.type === 'peer-unavailable') return 'That session is no longer open';
    if (err.type === 'browser-incompatible') return 'This browser cannot do peer-to-peer connections';
    return detail;
  }

  function track(connection) {
    connections.set(connection.peer, connection);
    connection.on('data', (raw) => {
      let message = raw;
      if (typeof raw === 'string') {
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }
      }
      // The host is the hub: pass anything a guest sends on to the other
      // guests, since they have no direct link to each other.
      if (role === 'host') {
        for (const [id, other] of connections) {
          if (id !== connection.peer && other.open) other.send(message);
        }
      }
      onMessage?.(message);
    });
    const drop = () => {
      connections.delete(connection.peer);
      // A guest holds exactly one connection: the host's. Losing it ends the
      // session, so fall back to idle — otherwise the UI would go on claiming
      // to be live and main.js would keep broadcasting edits into nothing.
      if (role === 'guest' && connections.size === 0 && !tearingDown) {
        destroy();
        role = null;
        sessionId = null;
        state = 'idle';
      }
      emit();
    };
    connection.on('close', drop);
    connection.on('error', drop);
  }

  // Closing a connection fires its own 'close' handler, which can loop back
  // in here; the flag keeps that re-entry from tearing down twice.
  let tearingDown = false;
  function destroy() {
    if (tearingDown) return;
    tearingDown = true;
    try {
      for (const connection of connections.values()) connection.close();
      connections.clear();
      peer?.destroy();
      peer = null;
    } finally {
      tearingDown = false;
    }
  }

  return {
    isActive: () => state === 'live' || state === 'connecting',
    getState: () => ({ state, role, sessionId, peers: connections.size }),

    // Opens a session and resolves with the id to invite people with.
    async host() {
      const Peer = await loadPeerLibrary();
      destroy();
      role = 'host';
      state = 'connecting';
      emit();

      return new Promise((resolve, reject) => {
        peer = new Peer();
        peer.on('open', (id) => {
          sessionId = id;
          state = 'live';
          emit();
          resolve(id);
        });
        peer.on('connection', (connection) => {
          connection.on('open', () => {
            track(connection);
            emit();
            // Hand the newcomer the current diagram straight away rather
            // than making them wait for the next edit to arrive.
            onStatus?.({ state, role, sessionId, peers: connections.size, joined: connection });
          });
        });
        peer.on('error', (err) => {
          state = 'error';
          const message = describe(err);
          emit(message);
          reject(new Error(message));
        });
      });
    },

    async join(hostId) {
      const Peer = await loadPeerLibrary();
      destroy();
      role = 'guest';
      sessionId = hostId;
      state = 'connecting';
      emit();

      return new Promise((resolve, reject) => {
        peer = new Peer();
        peer.on('open', () => {
          const connection = peer.connect(hostId, { reliable: true });
          connection.on('open', () => {
            track(connection);
            state = 'live';
            emit();
            resolve();
          });
          connection.on('error', (err) => {
            state = 'error';
            const message = describe(err);
            emit(message);
            reject(new Error(message));
          });
        });
        peer.on('error', (err) => {
          state = 'error';
          const message = describe(err);
          emit(message);
          reject(new Error(message));
        });
      });
    },

    send(message) {
      for (const connection of connections.values()) {
        if (connection.open) connection.send(message);
      }
    },

    // Sends to one specific peer — used to seed a newly-joined guest.
    sendTo(connection, message) {
      if (connection?.open) connection.send(message);
    },

    stop() {
      destroy();
      role = null;
      sessionId = null;
      state = 'idle';
      emit();
    },
  };
}
