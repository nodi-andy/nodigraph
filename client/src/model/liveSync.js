// Real-time push replaces the old 2s polling loop: the server broadcasts a
// fresh snapshot to every open client right after a save (see server/src/
// app.js), and relays ephemeral 'live' drag-position messages between
// clients without either side ever touching disk for them. Reconnects on
// its own (fixed short delay — this is a small local dev server, not a
// service worth exponential backoff for) if the server restarts.
const RECONNECT_DELAY_MS = 1000;

export function connectLiveSync({ onProject, onLive }) {
  let socket = null;
  let closedByUs = false;

  function connect() {
    socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/`);

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'project') onProject(message.data);
      else if (message.type === 'live') onLive(message);
    });

    socket.addEventListener('close', () => {
      if (!closedByUs) setTimeout(connect, RECONNECT_DELAY_MS);
    });
  }

  connect();

  return {
    sendLive(message) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'live', ...message }));
      }
    },
  };
}
