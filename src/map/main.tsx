// Map — preview entry point.
// Mounted by index.map.html into #map-root.

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MapPreviewApp } from "./MapPreviewApp";

const root = document.getElementById("map-root");
if (!root) throw new Error("[map] #map-root mount node not found");

const queryClient = new QueryClient();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MapPreviewApp />
    </QueryClientProvider>
  </React.StrictMode>,
);
