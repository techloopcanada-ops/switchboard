import { getToken } from './api';
import type { ServerMessage } from './types';

export function connectSocket(onMessage: (message: ServerMessage) => void, onStatus: (connected: boolean) => void) {
  let socket: WebSocket;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout>;
  let delay = 1000;
  function connect() {
    const url = new URL('/ws', window.location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', getToken());
    socket = new WebSocket(url);
    socket.onopen = () => { delay = 1000; onStatus(true); };
    socket.onmessage = event => {
      let message: ServerMessage;
      try { message = JSON.parse(String(event.data)) as ServerMessage; } catch { return; }
      onMessage(message);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      onStatus(false);
      if (!stopped) { retry = setTimeout(connect, delay); delay = Math.min(delay * 2, 15000); }
    };
  }
  connect();
  return {
    send(message: unknown) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('Connection lost. Reconnect before sending.');
      socket.send(JSON.stringify(message));
    },
    close() { stopped = true; clearTimeout(retry); socket.close(); },
  };
}
export type Socket = ReturnType<typeof connectSocket>;
