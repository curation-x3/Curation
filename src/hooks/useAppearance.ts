import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppearanceSettings,
  DEFAULTS,
  READER_SIZE_DEFAULT,
  apply,
  autoRootSize,
  clampReaderSize,
  load,
  save,
} from "../lib/appearance";

interface UseAppearance {
  saved: AppearanceSettings;
  draft: AppearanceSettings;
  autoSize: number;
  setDraft: (patch: Partial<AppearanceSettings>) => void;
  commit: () => void;
  cancel: () => void;
  resetDefaults: () => void;
  /** Directly change reader font size and persist immediately (used by shortcuts). */
  bumpReaderSize: (delta: number) => void;
  /** Reset reader size to default and persist (used by Cmd+0). */
  resetReaderSize: () => void;
}

export function useAppearance(): UseAppearance {
  const [saved, setSaved] = useState<AppearanceSettings>(() => load());
  const [draft, setDraftState] = useState<AppearanceSettings>(() => saved);
  const [viewport, setViewport] = useState<number>(() => window.innerWidth);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // Initial apply
  useEffect(() => {
    apply(saved, window.innerWidth);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track viewport
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Reapply when viewport changes and there's no override
  useEffect(() => {
    if (savedRef.current.rootSizeOverride === null) {
      apply(savedRef.current, viewport);
    }
  }, [viewport]);

  const setDraft = useCallback((patch: Partial<AppearanceSettings>) => {
    setDraftState((prev) => {
      const next = { ...prev, ...patch };
      apply(next, window.innerWidth);
      return next;
    });
  }, []);

  const commit = useCallback(() => {
    setDraftState((d) => {
      save(d);
      setSaved(d);
      return d;
    });
  }, []);

  const cancel = useCallback(() => {
    setDraftState(() => {
      apply(savedRef.current, window.innerWidth);
      return savedRef.current;
    });
  }, []);

  const resetDefaults = useCallback(() => {
    const next = { ...DEFAULTS };
    apply(next, window.innerWidth);
    setDraftState(next);
  }, []);

  const bumpReaderSize = useCallback((delta: number) => {
    const next: AppearanceSettings = {
      ...savedRef.current,
      readerSize: clampReaderSize(savedRef.current.readerSize + delta),
    };
    apply(next, window.innerWidth);
    save(next);
    setSaved(next);
    setDraftState(next);
  }, []);

  const resetReaderSize = useCallback(() => {
    const next: AppearanceSettings = {
      ...savedRef.current,
      readerSize: READER_SIZE_DEFAULT,
    };
    apply(next, window.innerWidth);
    save(next);
    setSaved(next);
    setDraftState(next);
  }, []);

  return {
    saved,
    draft,
    autoSize: autoRootSize(viewport),
    setDraft,
    commit,
    cancel,
    resetDefaults,
    bumpReaderSize,
    resetReaderSize,
  };
}
