// js/ws.js — STOMP-over-WebSocket client

import { getState } from './store.js';
import { toast }    from './ui.js';

let client     = null;
let sessionCode = null;
const handlers = new Map();   // eventType → Set of handlers

/**
 * Connect to a session's WebSocket channel.
 * @param {string} code        — session invite code
 * @param {string} [tokenOverride] — for observer tokens passed via URL
 */
export function connect(code, tokenOverride = null) {
  if (client?.active) disconnect();

  sessionCode = code;
  const token = tokenOverride || getState('token');

  client = new StompJs.Client({
    webSocketFactory: () => new SockJS('/ws'),

    connectHeaders: {
      Authorization: `Bearer ${token}`,
    },

    onConnect: () => {
      console.log('[WS] Connected to session', code);
      subscribeToSession(code);
    },

    onDisconnect: () => {
      console.log('[WS] Disconnected');
    },

    onStompError: (frame) => {
      console.error('[WS] STOMP error', frame);
      toast('Connection error — attempting to reconnect…', 'error');
    },

    reconnectDelay: 3000,
  });

  client.activate();
}

export function disconnect() {
  client?.deactivate();
  client = null;
  sessionCode = null;
  handlers.clear();
}

/** Subscribe to a specific event type from the session broadcast */
export function on(eventType, fn) {
  if (!handlers.has(eventType)) handlers.set(eventType, new Set());
  handlers.get(eventType).add(fn);
  return () => handlers.get(eventType)?.delete(fn);   // unsubscribe
}

/** Send a game action to the server */
export function send(actionType, payload) {
  if (!client?.active || !sessionCode) {
    console.warn('[WS] Cannot send — not connected');
    return;
  }
  client.publish({
    destination: `/app/session/${sessionCode}/action`,
    body: JSON.stringify({ type: actionType, payload }),
  });
}

// ── Private ───────────────────────────────────────────────────────

function subscribeToSession(code) {
  // Main broadcast — all clients
  client.subscribe(`/topic/session/${code}`, (msg) => {
    dispatch(JSON.parse(msg.body));
  });

  // DM-only channel
  client.subscribe(`/topic/session/${code}/dm`, (msg) => {
    dispatch(JSON.parse(msg.body));
  });

  // Per-user notifications (join accepted/denied, errors)
  client.subscribe('/user/queue/invite-result', (msg) => {
    dispatch({ type: 'INVITE_RESULT', payload: JSON.parse(msg.body) });
  });

  client.subscribe('/user/queue/errors', (msg) => {
    const { message } = JSON.parse(msg.body);
    toast(message, 'error');
  });
}

function dispatch(event) {
  const { type, payload } = event;
  console.debug('[WS] ←', type, payload);

  // Call all handlers registered for this event type
  handlers.get(type)?.forEach(fn => fn(payload));

  // Also call wildcard handlers
  handlers.get('*')?.forEach(fn => fn(event));
}
