import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const RealtimeContext = createContext({ connected: false, subscribe: () => () => {} });

/**
 * Authenticated Socket.IO connection.
 *
 * The session cookie authenticates the handshake; the server assigns the room.
 * On reconnect we explicitly re-sync (AppFlow §8: socket events are not the
 * only source of truth).
 */
export function RealtimeProvider({ children }) {
  const { status, refresh: refreshAuth } = useAuth();
  const toast = useToast();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    if (status !== 'authenticated') {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      return () => {};
    }

    const socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const emitToListeners = (event, payload) => {
      const set = listenersRef.current.get(event);
      if (set) set.forEach((fn) => fn(payload));
    };

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('sync', () => {});
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('dataset:processing', (p) => {
      emitToListeners('dataset:processing', p);
      emitToListeners('any', p);
    });
    socket.on('dataset:ready', (p) => {
      toast.success('Dataset ready', p.message || 'Your dataset finished importing.');
      emitToListeners('dataset:ready', p);
      emitToListeners('any', p);
    });
    socket.on('dataset:failed', (p) => {
      toast.error('Import failed', p.message || 'The dataset could not be processed.');
      emitToListeners('dataset:failed', p);
      emitToListeners('any', p);
    });
    socket.on('dashboard:refresh', (p) => {
      emitToListeners('dashboard:refresh', p);
      emitToListeners('any', p);
    });
    socket.on('forecast:ready', (p) => {
      toast.success('Forecast ready', p.message);
      emitToListeners('forecast:ready', p);
      emitToListeners('any', p);
    });
    socket.on('forecast:failed', (p) => {
      toast.error('Forecast failed', p.message);
      emitToListeners('forecast:failed', p);
      emitToListeners('any', p);
    });

    // A role change or suspension bumps token_version server-side; the socket
    // will be rejected on reconnect, at which point we re-validate the session.
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') refreshAuth();
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [status, toast, refreshAuth]);

  const subscribe = useCallback((event, fn) => {
    if (!listenersRef.current.has(event)) listenersRef.current.set(event, new Set());
    listenersRef.current.get(event).add(fn);
    return () => listenersRef.current.get(event)?.delete(fn);
  }, []);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
