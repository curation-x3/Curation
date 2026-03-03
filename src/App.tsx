import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/Sidebar";
import SourceManager from "./components/SourceManager";
import ArticleFeed from "./components/ArticleFeed";
import Settings from "./components/Settings";
import type { Article, AppSettings, View } from "./types";

const STORAGE_KEY_SETTINGS = "curation_settings";
const STORAGE_KEY_SOURCES = "curation_sources";

const defaultSettings: AppSettings = {
  apiKey: "",
  apiEndpoint: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  userInterests: "technology, programming, science, AI",
};

const defaultSources: string[] = [
  "https://news.ycombinator.com/rss",
  "https://lobste.rs/rss",
];

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // ignore
  }
  return fallback;
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function App() {
  const [view, setView] = useState<View>("feed");
  const [sources, setSources] = useState<string[]>(() =>
    loadFromStorage(STORAGE_KEY_SOURCES, defaultSources)
  );
  const [articles, setArticles] = useState<Article[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() =>
    loadFromStorage(STORAGE_KEY_SETTINGS, defaultSettings)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveToStorage(STORAGE_KEY_SOURCES, sources);
  }, [sources]);

  useEffect(() => {
    saveToStorage(STORAGE_KEY_SETTINGS, settings);
  }, [settings]);

  async function handleRefresh() {
    if (!settings.apiKey) {
      setError("Please configure your API key in Settings.");
      setView("settings");
      return;
    }
    if (sources.length === 0) {
      setError("Please add at least one source.");
      setView("sources");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Article[]>("fetch_and_curate", {
        sources,
        apiKey: settings.apiKey,
        apiEndpoint: settings.apiEndpoint,
        model: settings.model,
        userInterests: settings.userInterests,
      });
      const sorted = [...result].sort((a, b) => b.score - a.score);
      setArticles(sorted);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <Sidebar
        currentView={view}
        onNavigate={setView}
        onRefresh={handleRefresh}
        loading={loading}
        sourceCount={sources.length}
        articleCount={articles.length}
      />
      <main className="main-content">
        {error && (
          <div className="error-banner">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {view === "feed" && (
          <ArticleFeed
            articles={articles}
            loading={loading}
            onRefresh={handleRefresh}
          />
        )}
        {view === "sources" && (
          <SourceManager sources={sources} onSourcesChange={setSources} />
        )}
        {view === "settings" && (
          <Settings settings={settings} onSettingsChange={setSettings} />
        )}
      </main>
    </div>
  );
}

export default App;
