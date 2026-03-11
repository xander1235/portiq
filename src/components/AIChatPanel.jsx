import React, { useRef, useEffect, useState } from "react";
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rightRailStyles from "./Layout/RightRail.module.css";
import styles from "../App.module.css";
import { Copy, Check } from 'lucide-react';

// CSS for highlight.js can be imported in styles.css later if needed, 
// but even without it, the structure and copy button will be immense upgrades.

const CodeBlockWithCopy = ({ inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!inline && match) {
    return (
      <div style={{ position: 'relative', margin: '12px 0', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-hover)', padding: '4px 12px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{match[1]}</span>
          <button 
            onClick={handleCopy} 
            className="ghost icon-button" 
            style={{ padding: '4px', height: 'auto', color: copied ? 'var(--success)' : 'var(--text-muted)' }}
            title="Copy code"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <pre style={{ margin: 0, padding: '12px', overflowX: 'auto', background: 'var(--bg)', fontSize: '0.8rem' }}>
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  } else if (!inline) {
     return (
        <div style={{ position: 'relative', margin: '12px 0', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: 'var(--bg-hover)', padding: '4px 12px', borderBottom: '1px solid var(--border)' }}>
            <button 
              onClick={handleCopy} 
              className="ghost icon-button" 
              style={{ padding: '4px', height: 'auto', color: copied ? 'var(--success)' : 'var(--text-muted)' }}
              title="Copy text"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <pre style={{ margin: 0, padding: '12px', overflowX: 'auto', background: 'var(--bg)', fontSize: '0.8rem' }}>
            <code className={className} {...props}>
              {children}
            </code>
          </pre>
        </div>
     );
  }

  return (
    <code className={className} style={{ background: 'var(--bg-hover)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.9em' }} {...props}>
      {children}
    </code>
  );
};

/** Strip trailing date-version suffixes from model IDs (e.g. "-20251001", "-20240620") */
function formatModelName(model) {
    if (!model) return model;
    return model.replace(/-\d{8,}$/, '');
}

/**
 * AIChatPanel - AI Assistant chat panel for the right rail.
 * Extracted from App.jsx to reduce monolith size.
 */
export function AIChatPanel({
  showRightRail,
  setShowRightRail,
  responseSummary,
  setResponseSummary,
  response,
  isAiTyping,
  aiChatHistory,
  aiChatSessions,
  activeAiSessionId,
  setActiveAiSessionId,
  createNewAiSession,
  aiPrompt,
  setAiPrompt,
  handleAiChatSubmit,
  handleChatKeyDown,
  setMethod,
  setUrl,
  setHeadersText,
  setBodyText,
  aiProvider,
  activeModel,
  setActiveModel,
  availableModels,
  chatEndRef
}) {
  const [isAiModelDropdownOpen, setIsAiModelDropdownOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className={rightRailStyles.aiHeader}>
        <div className={rightRailStyles.aiHeaderMeta}>
          <div className={rightRailStyles.aiHeaderIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <div className={rightRailStyles.aiHeaderCopy}>
            <div className={rightRailStyles.aiEyebrow}>AI Assistant</div>
            <div className={rightRailStyles.aiTitle}>Chat and request guidance</div>
          </div>
        </div>
        <div className={rightRailStyles.aiHeaderActions}>
          {aiChatSessions && aiChatSessions.length > 0 && (
            <select 
              className={`input ${rightRailStyles.aiSessionSelect}`}
              value={activeAiSessionId || ''}
              onChange={(e) => setActiveAiSessionId(e.target.value)}
              title="Past Conversations"
            >
              {[...aiChatSessions].sort((a,b) => b.timestamp - a.timestamp).map((s) => (
                <option key={s.id} value={s.id}>
                  Chat {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </option>
              ))}
            </select>
          )}
          <button className={`ghost icon-button ${rightRailStyles.aiHeaderButton}`} onClick={createNewAiSession} title="New Chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button className={`ghost icon-button ${rightRailStyles.aiHeaderButton}`} onClick={() => setShowRightRail(false)} title="Collapse">
            →
          </button>
        </div>
      </div>

      {aiProvider === 'anthropic' && (
        <div style={{ padding: '6px 12px', fontSize: '0.7rem', background: 'rgba(255,165,0,0.1)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
          <strong>Note:</strong> Anthropic does not support persistent history context. Each message is processed independently.
        </div>
      )}

      {responseSummary && responseSummary.summary !== "No response yet." && (
        <div className={`${rightRailStyles.card} ${rightRailStyles.responseInsightCard}`}>
          <button
            className={`ghost icon-button ${rightRailStyles.responseInsightDismiss}`}
            onClick={() => setResponseSummary(null)}
            title="Dismiss"
          >
            ✕
          </button>
          <div className={rightRailStyles.responseInsightHeader}>
            <div>
              <div className={rightRailStyles.responseInsightEyebrow}>Response Intelligence</div>
              <div className={rightRailStyles.responseInsightTitle}>
                {response?.status ? `Status ${response.status}` : "Latest response"}
              </div>
            </div>
            {response?.status && (
              <span className={rightRailStyles.responseInsightBadge}>
                {response.status >= 400 ? "Needs attention" : "Healthy"}
              </span>
            )}
          </div>
          <div className={rightRailStyles.responseInsightSummary}>{responseSummary.summary}</div>
          {responseSummary.hints.length > 0 && (
            <div className={rightRailStyles.responseInsightHint}>
              <span>Hint</span>
              <div>{responseSummary.hints[0]}</div>
            </div>
          )}
          {response?.status >= 400 && response?.status < 600 && (
            <button
              className={`ghost compact ${rightRailStyles.responseInsightAction}`}
              onClick={() => {
                const errorMsg = typeof response?.data === 'object' ? JSON.stringify(response.data).substring(0, 100) : (response?.statusText || "Unknown error");
                handleAiChatSubmit(`This request failed with status ${response.status} and error '${errorMsg}'. Please fix my request.`);
              }}
              disabled={isAiTyping}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 9.36l-7.15 7.15a2 2 0 0 1-2.83-2.83l7.15-7.15a6 6 0 0 1 9.36-7.94l-3.77 3.77z" /></svg>
              Fix this Request
            </button>
          )}
        </div>
      )}

      <div className={rightRailStyles.chatContainer}>
        <div className={rightRailStyles.messages}>
          {aiChatHistory.map((msg, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div className={`${rightRailStyles.message} ${msg.role === 'user' ? rightRailStyles.messageUser : rightRailStyles.messageAssistant}`}>
                {msg.role === 'user' ? (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                ) : (
                  <div className="markdown-body" style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>
                    <ReactMarkdown 
                      rehypePlugins={[rehypeHighlight]}
                      components={{
                        code: CodeBlockWithCopy,
                        pre: ({node, ...props}) => <>{props.children}</>,
                        p: ({node, ...props}) => <div style={{ margin: '0 0 8px 0', whiteSpace: 'pre-wrap' }} {...props} />,
                        ul: ({node, ...props}) => <ul style={{ margin: '0 0 8px 0', paddingLeft: '20px' }} {...props} />,
                        ol: ({node, ...props}) => <ol style={{ margin: '0 0 8px 0', paddingLeft: '20px' }} {...props} />,
                        li: ({node, ...props}) => <li style={{ marginBottom: '4px' }} {...props} />
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                )}

                {msg.suggestedEndpoints && msg.suggestedEndpoints.length > 0 && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Did you mean:</div>
                    {msg.suggestedEndpoints.map((ep, i) => (
                      <button
                        key={i}
                        className="ghost"
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          justifyContent: 'flex-start', padding: '8px 12px',
                          border: '1px solid var(--border)', borderRadius: '6px',
                          background: 'var(--bg)', textAlign: 'left', width: '100%'
                        }}
                        onClick={() => {
                          if (ep.method) setMethod(ep.method);
                          if (ep.url) setUrl(ep.url);
                          if (ep.headersText) setHeadersText(ep.headersText);
                          if (ep.bodyText) setBodyText(ep.bodyText);
                        }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.75rem', padding: '2px 6px', background: 'var(--accent-alpha, rgba(var(--accent-rgb), 0.1))', borderRadius: '4px' }}>{ep.method || "GET"}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{ep.name || "Request"}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{ep.url}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Meta for assistant (model and output tokens) or user (input tokens) */}
              {(msg.model || msg.usage) && (
                <div className={rightRailStyles.messageMeta}>
                  {msg.model && (
                    <span className={rightRailStyles.modelBadge}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
                      {formatModelName(msg.model)}
                    </span>
                  )}
                  {msg.usage && msg.usage.input && (
                    <span title="Input tokens" style={{ color: 'var(--accent)' }}>↑ {msg.usage.input.toLocaleString()} tokens</span>
                  )}
                  {msg.usage && msg.usage.output && (
                    <span title="Output tokens">↓ {msg.usage.output.toLocaleString()} tokens</span>
                  )}
                </div>
              )}
            </div>
          ))}

          {isAiTyping && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <div className={`${rightRailStyles.message} ${rightRailStyles.messageAssistant} ${rightRailStyles.typingIndicator}`}>
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div style={{ padding: '0 12px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className={rightRailStyles.inputWrapper} style={{ padding: 0, margin: 0 }}>
            <textarea
              className={rightRailStyles.chatInput}
              placeholder="Ask AI to generate requests or tests..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={handleChatKeyDown}
              rows={1}
            />
            <button className={rightRailStyles.sendButton} onClick={handleAiChatSubmit} title="Send Message">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
            <div
              style={{
                fontSize: '0.65rem', padding: '4px 8px', background: 'var(--bg)', color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)', borderRadius: '12px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px', userSelect: 'none',
                transition: 'background 0.2s, color 0.2s',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              onClick={() => setIsAiModelDropdownOpen(!isAiModelDropdownOpen)}
              title="Select AI Model"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
              {activeModel ? activeModel.replace(/-\d{4,8}$/, '') : ''}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: '4px', transform: isAiModelDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 15 12 9 18 15"></polyline></svg>
            </div>

            {isAiModelDropdownOpen && (
              <>
                <div
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                  onClick={() => setIsAiModelDropdownOpen(false)}
                />
                <div className="dropdown-scroll" style={{
                  position: 'absolute', bottom: '100%', left: 0, marginBottom: '8px', zIndex: 100,
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.2)', padding: '6px', minWidth: '220px',
                  maxHeight: '300px', overflowY: 'auto',
                  display: 'flex', flexDirection: 'column', gap: '2px'
                }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {aiProvider} Models
                  </div>
                  {availableModels.length > 0 ? (
                    availableModels.map(m => (
                      <button
                        key={m}
                        className="ghost"
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '6px 8px', borderRadius: '4px', textAlign: 'left',
                          fontSize: '0.75rem', color: m === activeModel ? 'var(--accent)' : 'var(--text)',
                          background: m === activeModel ? 'var(--bg)' : 'transparent',
                          border: 'none', cursor: 'pointer', width: '100%'
                        }}
                        onClick={() => { setActiveModel(m); setIsAiModelDropdownOpen(false); }}
                      >
                        {m === activeModel && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                        <span style={{ marginLeft: m === activeModel ? 0 : '20px' }}>{m.replace(/-\d{4,8}$/, '')}</span>
                      </button>
                    ))
                  ) : (
                    <div style={{ padding: '6px 8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Offline</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AIChatPanel;
