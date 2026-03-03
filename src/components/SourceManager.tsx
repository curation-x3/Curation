import { useState } from "react";

interface SourceManagerProps {
  sources: string[];
  onSourcesChange: (sources: string[]) => void;
}

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function sourceIcon(url: string): string {
  if (url.includes("rss") || url.includes("feed") || url.includes("atom"))
    return "📡";
  if (url.includes("reddit.com")) return "🤖";
  if (url.includes("github.com")) return "🐱";
  if (url.includes("hackernews") || url.includes("ycombinator")) return "🧡";
  return "🌐";
}

export default function SourceManager({
  sources,
  onSourcesChange,
}: SourceManagerProps) {
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");

  function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (!isValidUrl(trimmed)) {
      setInputError("Please enter a valid URL (starting with http:// or https://)");
      return;
    }
    if (sources.includes(trimmed)) {
      setInputError("This source is already added.");
      return;
    }
    onSourcesChange([...sources, trimmed]);
    setInputValue("");
    setInputError("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleAdd();
    else setInputError("");
  }

  function handleRemove(url: string) {
    onSourcesChange(sources.filter((s) => s !== url));
  }

  return (
    <div className="source-manager">
      <div className="page-header">
        <div>
          <h2>Sources</h2>
          <p>Manage RSS feeds and URLs to track</p>
        </div>
      </div>

      <div className="source-add-form">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
          <input
            className="source-input"
            type="url"
            placeholder="https://example.com/rss or any webpage URL"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setInputError("");
            }}
            onKeyDown={handleKeyDown}
          />
          {inputError && (
            <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>
              {inputError}
            </span>
          )}
        </div>
        <button className="btn-primary" onClick={handleAdd}>
          + Add
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="source-empty">
          <span style={{ fontSize: "2rem" }}>📡</span>
          <p>No sources added yet. Add an RSS feed or URL above.</p>
        </div>
      ) : (
        <ul className="source-list">
          {sources.map((url) => (
            <li key={url} className="source-item">
              <span className="source-icon">{sourceIcon(url)}</span>
              <span className="source-url" title={url}>
                {url}
              </span>
              <button
                className="source-remove"
                onClick={() => handleRemove(url)}
                title="Remove source"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
