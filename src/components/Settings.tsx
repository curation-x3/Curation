import { useState } from "react";
import type { AppSettings } from "../types";

interface SettingsProps {
  settings: AppSettings;
  onSettingsChange: (s: AppSettings) => void;
}

export default function Settings({ settings, onSettingsChange }: SettingsProps) {
  const [local, setLocal] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);

  function handleChange(field: keyof AppSettings, value: string) {
    setLocal((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  function handleSave() {
    onSettingsChange(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="feed-container">
      <div className="page-header">
        <div>
          <h2>Settings</h2>
          <p>Configure your AI provider and curation preferences</p>
        </div>
      </div>

      <div className="settings-container">
        {/* AI Provider */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>🤖 AI Provider</h3>
            <p>OpenAI-compatible API configuration</p>
          </div>
          <div className="settings-fields">
            <div className="field-group">
              <label className="field-label">API Key</label>
              <input
                className="field-input"
                type="password"
                placeholder="sk-..."
                value={local.apiKey}
                onChange={(e) => handleChange("apiKey", e.target.value)}
              />
              <span className="field-hint">Your key is stored locally and never sent anywhere except your configured endpoint.</span>
            </div>
            <div className="field-group">
              <label className="field-label">API Endpoint</label>
              <input
                className="field-input"
                type="url"
                placeholder="https://api.openai.com/v1"
                value={local.apiEndpoint}
                onChange={(e) => handleChange("apiEndpoint", e.target.value)}
              />
              <span className="field-hint">Use any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, etc.)</span>
            </div>
            <div className="field-group">
              <label className="field-label">Model</label>
              <input
                className="field-input"
                type="text"
                placeholder="gpt-4o-mini"
                value={local.model}
                onChange={(e) => handleChange("model", e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Interests */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3>🎯 Your Interests</h3>
            <p>The AI will rank articles based on these topics</p>
          </div>
          <div className="settings-fields">
            <div className="field-group">
              <label className="field-label">Topics & Interests</label>
              <textarea
                className="field-input"
                placeholder="e.g. Rust programming, distributed systems, machine learning, open source..."
                value={local.userInterests}
                onChange={(e) => handleChange("userInterests", e.target.value)}
              />
              <span className="field-hint">Describe what you care about. Be specific for better curation.</span>
            </div>
          </div>
        </div>

        <div className="settings-save">
          {saved ? (
            <span className="save-success">✓ Settings saved</span>
          ) : (
            <button className="btn-primary" onClick={handleSave}>
              Save Settings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
