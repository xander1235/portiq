import React, { useState } from "react";
import { fetchModels } from "../../services/ai";

/**
 * SettingsModal - App settings (AI config, preferences, data management)
 * Extracted from App.jsx to reduce monolith size.
 */
export function SettingsModal({
  onClose,
  aiProvider,
  setAiProvider,
  aiApiKeyOpenAI,
  setAiApiKeyOpenAI,
  aiApiKeyAnthropic,
  setAiApiKeyAnthropic,
  aiApiKeyGemini,
  setAiApiKeyGemini,
  aiSemanticSearchEnabled,
  setAiSemanticSearchEnabled,
  semanticProgress,
  historyRetentionDays,
  setHistoryRetentionDays
}) {
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const providerMeta = {
    openai: {
      label: "OpenAI API Key",
      placeholder: "sk-..."
    },
    anthropic: {
      label: "Anthropic API Key",
      placeholder: "sk-ant-..."
    },
    gemini: {
      label: "Gemini API Key",
      placeholder: "AIza..."
    }
  };

  const currentProvider = providerMeta[aiProvider] || providerMeta.openai;
  const currentApiKey =
    aiProvider === "openai"
      ? aiApiKeyOpenAI
      : aiProvider === "anthropic"
        ? aiApiKeyAnthropic
        : aiApiKeyGemini;

  const setCurrentApiKey = (value) => {
    if (aiProvider === "openai") setAiApiKeyOpenAI(value);
    else if (aiProvider === "anthropic") setAiApiKeyAnthropic(value);
    else setAiApiKeyGemini(value);
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      let key = "";
      if (aiProvider === 'openai') key = aiApiKeyOpenAI;
      else if (aiProvider === 'anthropic') key = aiApiKeyAnthropic;
      else if (aiProvider === 'gemini') key = aiApiKeyGemini;

      if (!key) {
        setTestResult({ success: false, message: "Please enter an API key first." });
        setTestingConnection(false);
        return;
      }

      const models = await fetchModels(aiProvider, key, () => { });
      if (models.length > 0) {
        setTestResult({ success: true, message: `Connected! Built-in & supported models fetched successfully.` });
      } else {
        setTestResult({ success: false, message: "Failed to fetch models or invalid API key." });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message || "Connection failed." });
    }
    setTestingConnection(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <div>
            <div className="modal-title">Settings</div>
            <p className="settings-modal-subtitle">
              Configure AI providers, app behavior, and local data management.
            </p>
          </div>
          <button className="ghost compact" onClick={onClose}>Close</button>
        </div>

        <div className="settings-modal-body">
          <section className="settings-section">
            <div className="settings-section-header">
              <div>
                <h4>AI Configuration</h4>
                <p>Choose a provider and verify the current API key.</p>
              </div>
              <button className="primary" onClick={handleTestConnection} disabled={testingConnection}>
                {testingConnection ? "Testing..." : "Test Connection"}
              </button>
            </div>

            <div className="settings-field-grid">
              <div className="settings-field">
                <label>AI Provider</label>
                <select className="input" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </div>

              <div className="settings-field">
                <label>{currentProvider.label}</label>
                <input
                  type="password"
                  className="input"
                  value={currentApiKey}
                  onChange={(e) => setCurrentApiKey(e.target.value)}
                  placeholder={currentProvider.placeholder}
                />
              </div>
            </div>

            {testResult && (
              <div className={testResult.success ? "settings-notice success" : "settings-notice error"}>
                <span className="settings-notice-badge">{testResult.success ? "Connected" : "Error"}</span>
                <span>{testResult.message}</span>
              </div>
            )}
          </section>

          <section className="settings-section">
            <div className="settings-section-header">
              <div>
                <h4>Preferences</h4>
                <p>Toggle local AI features and request behavior.</p>
              </div>
            </div>

            <div className="settings-toggle-list">
              <label className="settings-toggle-row">
                <div>
                  <span>Enable AI Semantic Search</span>
                  <small>Use local embeddings for semantic lookup across saved content.</small>
                  {aiSemanticSearchEnabled && (
                    <span className="settings-inline-note">
                      {semanticProgress || "No download progress means the model is already cached locally."}
                    </span>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={aiSemanticSearchEnabled}
                  onChange={(e) => setAiSemanticSearchEnabled(e.target.checked)}
                />
              </label>

              <label className="settings-toggle-row">
                <div>
                  <span>Enable AI request generation</span>
                  <small>Allow prompt-based request creation in the main editor.</small>
                </div>
                <input type="checkbox" defaultChecked />
              </label>

              <label className="settings-toggle-row">
                <div>
                  <span>Enable response summaries</span>
                  <small>Generate condensed response analysis after requests complete.</small>
                </div>
                <input type="checkbox" defaultChecked />
              </label>

              <label className="settings-toggle-row">
                <div>
                  <span>Redact secrets before AI</span>
                  <small>Strip sensitive tokens before sending data to external AI services.</small>
                </div>
                <input type="checkbox" />
              </label>
            </div>

            <div className="settings-field-grid compact">
              <div className="settings-field">
                <label>History Retention (Days)</label>
                <input
                  type="number"
                  className="input"
                  min="1"
                  max="365"
                  value={historyRetentionDays}
                  onChange={(e) => setHistoryRetentionDays(Number(e.target.value))}
                />
              </div>
            </div>
          </section>

          <section className="settings-section danger">
            <div className="settings-section-header">
              <div>
                <h4>Data Management</h4>
                <p>Inspect local storage or clear all persisted app data.</p>
              </div>
            </div>

            <div className="settings-danger-card">
              <p>
                Your data is stored locally on this device. Clearing data permanently removes all
                collections, history, environments, and saved settings.
              </p>
              <div className="settings-action-row">
                <button
                  className="ghost danger"
                  onClick={async () => {
                    const confirmed = window.confirm(
                      "Are you sure you want to delete ALL app data?\n\nThis will permanently remove:\n• All collections and requests\n• All request history\n• All environments and variables\n• All settings and API keys\n\nThis action cannot be undone."
                    );
                    if (confirmed) {
                      const secondConfirm = window.confirm(
                        "FINAL WARNING: This will erase everything. The app will reload with a fresh state.\n\nContinue?"
                      );
                      if (secondConfirm) {
                        try {
                          await window.api.clearAllData();
                          window.location.reload();
                        } catch (err) {
                          alert("Failed to clear data: " + err.message);
                        }
                      }
                    }
                  }}
                >
                  Clear All App Data
                </button>
                <button
                  className="ghost"
                  onClick={async () => {
                    try {
                      const p = await window.api.getDataPath();
                      alert("Your app data is stored at:\n\n" + p + "\n\nYou can manually delete this folder for a complete cleanup after uninstalling.");
                    } catch {
                      alert("Data path: ~/Library/Application Support/Commu/");
                    }
                  }}
                >
                  Show Data Location
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="modal-footer settings-modal-footer">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
