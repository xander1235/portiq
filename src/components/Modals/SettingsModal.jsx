import React from "react";

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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Settings</div>

        <h4 style={{ margin: '16px 0 8px 0', fontSize: '0.875rem', fontWeight: 600 }}>AI Configuration</h4>
        <div className="modal-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label>AI Provider</label>
          <select className="input" style={{ width: '180px' }} value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </div>

        {aiProvider === 'openai' && (
          <div className="modal-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>OpenAI API Key</label>
            <input type="password" className="input" style={{ width: '172px' }} value={aiApiKeyOpenAI} onChange={(e) => setAiApiKeyOpenAI(e.target.value)} placeholder="sk-..." />
          </div>
        )}
        {aiProvider === 'anthropic' && (
          <div className="modal-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Anthropic API Key</label>
            <input type="password" className="input" style={{ width: '172px' }} value={aiApiKeyAnthropic} onChange={(e) => setAiApiKeyAnthropic(e.target.value)} placeholder="sk-ant-..." />
          </div>
        )}
        {aiProvider === 'gemini' && (
          <div className="modal-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Gemini API Key</label>
            <input type="password" className="input" style={{ width: '172px' }} value={aiApiKeyGemini} onChange={(e) => setAiApiKeyGemini(e.target.value)} placeholder="AIza..." />
          </div>
        )}

        <hr style={{ margin: '16px 0', borderColor: 'var(--border)' }} />
        <h4 style={{ margin: '0 0 8px 0', fontSize: '0.875rem', fontWeight: 600 }}>Preferences</h4>

        <div className="modal-row" style={{ display: 'flex', flexDirection: 'column' }}>
          <label>
            <input
              type="checkbox"
              checked={aiSemanticSearchEnabled}
              onChange={(e) => setAiSemanticSearchEnabled(e.target.checked)}
            /> Enable AI Semantic Search (Local RAG)
          </label>
          {aiSemanticSearchEnabled && semanticProgress && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '24px', marginTop: '4px' }}>
              {semanticProgress}
            </span>
          )}
        </div>
        <div className="modal-row">
          <label>
            <input type="checkbox" defaultChecked /> Enable AI request generation
          </label>
        </div>
        <div className="modal-row">
          <label>
            <input type="checkbox" defaultChecked /> Enable response summaries
          </label>
        </div>
        <div className="modal-row">
          <label>
            <input type="checkbox" /> Redact secrets before AI
          </label>
        </div>

        <hr style={{ margin: '16px 0', borderColor: 'var(--border)' }} />

        <div className="modal-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label>History Retention (Days)</label>
          <input
            type="number"
            className="input"
            style={{ width: '80px' }}
            min="1"
            max="365"
            value={historyRetentionDays}
            onChange={(e) => setHistoryRetentionDays(Number(e.target.value))}
          />
        </div>

        <hr style={{ margin: '16px 0', borderColor: 'var(--border)' }} />
        <h4 style={{ margin: '0 0 8px 0', fontSize: '0.875rem', fontWeight: 600, color: 'var(--danger, #ef4444)' }}>Data Management</h4>

        <div className="modal-row" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Your data is stored locally on this device. Clearing data will permanently delete all collections, history, environments, and settings.
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="ghost"
              style={{
                color: 'var(--danger, #ef4444)',
                borderColor: 'var(--danger, #ef4444)',
                fontSize: '0.8rem',
                padding: '6px 12px'
              }}
              onClick={async () => {
                const confirmed = window.confirm(
                  'Are you sure you want to delete ALL app data?\n\nThis will permanently remove:\n• All collections and requests\n• All request history\n• All environments and variables\n• All settings and API keys\n\nThis action cannot be undone.'
                );
                if (confirmed) {
                  const secondConfirm = window.confirm(
                    'FINAL WARNING: This will erase everything. The app will reload with a fresh state.\n\nContinue?'
                  );
                  if (secondConfirm) {
                    try {
                      await window.api.clearAllData();
                      window.location.reload();
                    } catch (err) {
                      alert('Failed to clear data: ' + err.message);
                    }
                  }
                }
              }}
            >
              🗑️ Clear All App Data
            </button>
            <button
              className="ghost"
              style={{ fontSize: '0.8rem', padding: '6px 12px' }}
              onClick={async () => {
                try {
                  const p = await window.api.getDataPath();
                  alert('Your app data is stored at:\n\n' + p + '\n\nYou can manually delete this folder for a complete cleanup after uninstalling.');
                } catch {
                  alert('Data path: ~/Library/Application Support/Commu/');
                }
              }}
            >
              📂 Show Data Location
            </button>
          </div>
        </div>

        <button className="primary" onClick={onClose} style={{ marginTop: '16px', width: '100%' }}>Close</button>
      </div>
    </div>
  );
}

export default SettingsModal;
