import { useState, useEffect, useCallback } from "react";

const LAYOUT_RATIO_SIDEBAR = 1;
const LAYOUT_RATIO_LIST = 1.8;
const LAYOUT_RATIO_READER = 4;
const LAYOUT_RATIO_SUM = LAYOUT_RATIO_SIDEBAR + LAYOUT_RATIO_LIST + LAYOUT_RATIO_READER;
const LIST_READER_RESIZER_PX = 5;

function initialColumnWidthsFromViewport(): { sidebar: number; list: number } {
  const w = typeof window !== "undefined" ? window.innerWidth : 1200;
  const avail = Math.max(0, w - LIST_READER_RESIZER_PX);
  const unit = avail / LAYOUT_RATIO_SUM;
  const sidebar = Math.max(150, Math.min(500, Math.round(unit * LAYOUT_RATIO_SIDEBAR)));
  const list = Math.max(200, Math.min(600, Math.round(unit * LAYOUT_RATIO_LIST)));
  return { sidebar, list };
}

export function useLayout() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const raw = localStorage.getItem("curation_sidebar_width");
    if (raw != null && raw !== "") {
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
    }
    return initialColumnWidthsFromViewport().sidebar;
  });
  const [listWidth, setListWidth] = useState(() => {
    const raw = localStorage.getItem("curation_list_width");
    if (raw != null && raw !== "") {
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
    }
    return initialColumnWidthsFromViewport().list;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingList, setIsResizingList] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar && !isSidebarCollapsed) {
        const newWidth = Math.max(150, Math.min(500, e.clientX));
        setSidebarWidth(newWidth);
      } else if (isResizingList) {
        const currentSidebarWidth = isSidebarCollapsed ? 72 : sidebarWidth;
        const newWidth = Math.max(200, Math.min(600, e.clientX - currentSidebarWidth));
        setListWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizingSidebar) localStorage.setItem("curation_sidebar_width", String(sidebarWidth));
      if (isResizingList) localStorage.setItem("curation_list_width", String(listWidth));
      setIsResizingSidebar(false);
      setIsResizingList(false);
      document.body.style.cursor = "default";
    };

    if (isResizingSidebar || isResizingList) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar, isResizingList, sidebarWidth, isSidebarCollapsed]);

  const startResizeSidebar = useCallback(() => setIsResizingSidebar(true), []);
  const startResizeList = useCallback(() => setIsResizingList(true), []);
  const toggleSidebar = useCallback(() => setIsSidebarCollapsed(v => !v), []);

  return {
    isSidebarCollapsed,
    sidebarWidth,
    listWidth,
    isResizingList,
    startResizeSidebar,
    startResizeList,
    toggleSidebar,
  };
}
