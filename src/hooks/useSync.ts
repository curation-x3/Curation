import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { runSync, openDbFromKeychain, initDbWithLogin, setCacheAuthToken, setApiBase } from "../lib/cache";
import { getWsBase, getAuthToken, getApiBase } from "../lib/api";

export function useInitCache(isLoggedIn: boolean, userId: string | null) {
  const initialized = useRef(false);
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || !userId || initialized.current) return;

    async function init() {
      const token = getAuthToken();
      if (!token) return;

      // Set API base URL for Rust sync client (matches frontend's API_BASE)
      await setApiBase(getApiBase());

      const opened = await openDbFromKeychain().catch(() => false);
      if (opened) {
        await setCacheAuthToken(token);
      } else {
        await initDbWithLogin(token, userId!);
      }
      initialized.current = true;
      setCacheReady(true);
    }

    init().catch(console.error);
  }, [isLoggedIn, userId]);

  return { initialized, cacheReady };
}

export function useSyncManager(isLoggedIn: boolean) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageTime = useRef(Date.now());
  const syncInProgress = useRef(false);
  const [syncing, setSyncing] = useState(false);

  const triggerSync = useCallback(async () => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setSyncing(true);
    const t0 = performance.now();
    try {
      const changedKeys = await runSync();
      const dt = Math.round(performance.now() - t0);
      if (changedKeys.length > 0) {
        console.log(`[sync] ${dt}ms`, changedKeys);
      }
      for (const key of changedKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch (e) {
      console.error("[sync] failed:", e);
    } finally {
      syncInProgress.current = false;
      setSyncing(false);
    }
  }, [queryClient]);

  // WebSocket connection with auto-reconnect
  const connectWs = useCallback(() => {
    const token = getAuthToken();
    if (!token) return;

    const wsBase = getWsBase();
    const ws = new WebSocket(`${wsBase}/ws/sync?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      lastMessageTime.current = Date.now();
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "sync_available") {
          triggerSync();
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        // Auto-reconnect after 5 seconds
        reconnectTimer.current = setTimeout(connectWs, 5000);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }, [triggerSync]);

  useEffect(() => {
    if (!isLoggedIn) return;
    connectWs();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };
  }, [isLoggedIn, connectWs]);

  // Heartbeat: sync every 5 min if no WS messages
  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(() => {
      if (Date.now() - lastMessageTime.current > 5 * 60 * 1000) {
        triggerSync();
        lastMessageTime.current = Date.now();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [isLoggedIn, triggerSync]);

  // Initial sync on mount
  useEffect(() => {
    if (!isLoggedIn) return;
    const timer = setTimeout(triggerSync, 2000);
    return () => clearTimeout(timer);
  }, [isLoggedIn, triggerSync]);

  // Progressive invalidation: each committed page triggers query invalidation
  // immediately rather than waiting for the full sync to complete.
  useEffect(() => {
    const unlistenP = listen<{ changedKeys?: string[] }>("sync-page-committed", (evt) => {
      const keys = evt.payload?.changedKeys ?? ["inbox"];
      for (const k of keys) {
        queryClient.invalidateQueries({ queryKey: [k] });
      }
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, [queryClient]);

  return { triggerSync, syncing };
}
