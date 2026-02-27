import React, { useState } from "react";
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json } from '@codemirror/lang-json';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { lintGutter } from '@codemirror/lint';

import { xmlLinter } from "../../utils/codemirror/xmlExtensions.js";
import { customJsonLinter } from "../../utils/codemirror/jsonExtensions.js";
import { envVarHighlightPlugin, createEnvAutoComplete, createEnvHoverTooltip } from "../../utils/codemirror/environmentExtensions.js";
import { search } from '@codemirror/search';

import { TableEditor } from "../TableEditor.jsx";
import { EnvInput } from "../TableEditor.jsx";
import { FullScreenModal } from "../Modals/FullScreenModal.jsx";
import { prettifyXml } from "../../services/format.js";
import styles from "./RequestEditor.module.css";

export function RequestEditor({
    editingMainRequestName,
    setEditingMainRequestName,
    requestName,
    setRequestName,
    currentRequestId,
    updateRequestName,
    setShowSnippetModal,
    method,
    setMethod,
    updateRequestMethod,
    url,
    setUrl,
    getEnvVars,
    handleUpdateEnvVar,
    handleSend,
    isSending,
    requestTabs,
    activeRequestTab,
    setActiveRequestTab,
    headersMode,
    setHeadersMode,
    bodyType,
    setBodyType,
    setContentType,
    bodyText,
    setBodyText,
    showTestOutput,
    setShowTestOutput,
    showTestInput,
    setShowTestInput,
    testsMode,
    setTestsMode,
    runTests,
    paramsRows,
    setParamsRows,
    updateRequestState,
    headersRows,
    handleHeadersRowsChange,
    headersText,
    handleHeadersTextChange,
    authType,
    setAuthType,
    authConfig,
    setAuthConfig,
    authRows,
    setAuthRows,
    setCmEnvEdit,
    bodyRows,
    setBodyRows,
    testsInputText,
    setTestsInputText,
    testsPreText,
    setTestsPreText,
    testsPostText,
    setTestsPostText,
    testsOutput
}) {
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showBodyTypeDropdown, setShowBodyTypeDropdown] = useState(false);
    const [showAuthTypeDropdown, setShowAuthTypeDropdown] = useState(false);

    return (
        <section className={styles.request}>
            <div className={styles.requestTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    {editingMainRequestName ? (
                        <input
                            autoFocus
                            className="input compact"
                            value={requestName}
                            onChange={(e) => setRequestName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
                                    if (currentRequestId) {
                                        updateRequestName(currentRequestId, requestName.trim() || "New Request");
                                    }
                                    setEditingMainRequestName(false);
                                }
                            }}
                            onBlur={() => {
                                if (currentRequestId) {
                                    updateRequestName(currentRequestId, requestName.trim() || "New Request");
                                }
                                setEditingMainRequestName(false);
                            }}
                        />
                    ) : (
                        <span className="request-name" onDoubleClick={() => setEditingMainRequestName(true)}>
                            {requestName}
                        </span>
                    )}
                </div>
                <button
                    className="ghost icon-button"
                    title="Export Code Snippet"
                    onClick={() => setShowSnippetModal(true)}
                >
                    &lt;/&gt;
                </button>
            </div>
            <div className={styles.requestBar}>
                <select
                    className="input method"
                    value={method}
                    onChange={(e) => {
                        setMethod(e.target.value);
                        if (currentRequestId) {
                            updateRequestMethod(currentRequestId, e.target.value);
                        }
                    }}
                >
                    <option>GET</option>
                    <option>POST</option>
                    <option>PUT</option>
                    <option>DELETE</option>
                </select>
                <EnvInput
                    className={`input ${styles.url}`}
                    value={url}
                    onChange={(val) => setUrl(val)}
                    envVars={getEnvVars()}
                    onUpdateEnvVar={handleUpdateEnvVar}
                    placeholder="https://api.example.com/v1/users/{{id}}"
                    style={{ flex: 1 }}
                />
                <button className="primary" onClick={handleSend} disabled={isSending}>
                    {isSending ? "Sending..." : "Send"}
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div className={styles.tabs} style={{ marginBottom: 0 }}>
                    {requestTabs.map((tab) => (
                        <button
                            key={tab}
                            className={tab === activeRequestTab ? `${styles.tab} ${styles.active}` : styles.tab}
                            onClick={() => setActiveRequestTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {activeRequestTab === "Headers" && (
                        <div className={styles.tabs} style={{ marginBottom: 0 }}>
                            <button
                                className={headersMode === "table" ? `${styles.tab} ${styles.active}` : styles.tab}
                                onClick={() => setHeadersMode("table")}
                            >
                                Table
                            </button>
                            <button
                                className={headersMode === "json" ? `${styles.tab} ${styles.active}` : styles.tab}
                                onClick={() => setHeadersMode("json")}
                            >
                                JSON
                            </button>
                        </div>
                    )}
                    {activeRequestTab === "Body" && (
                        <>
                            <div style={{ position: 'relative' }}>
                                <button
                                    style={{
                                        width: '180px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        padding: '4px 10px',
                                        height: '28px',
                                        background: 'var(--panel)',
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                        color: 'var(--text)',
                                        transition: 'all 0.2s ease',
                                        boxShadow: showBodyTypeDropdown ? '0 0 0 2px rgba(46, 211, 198, 0.2)' : '0 2px 4px rgba(0,0,0,0.05)',
                                        borderColor: showBodyTypeDropdown ? 'var(--accent-2)' : 'var(--border)'
                                    }}
                                    onMouseOver={(e) => {
                                        if (!showBodyTypeDropdown) {
                                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                                            e.currentTarget.style.background = 'var(--panel-3)';
                                        }
                                    }}
                                    onMouseOut={(e) => {
                                        if (!showBodyTypeDropdown) {
                                            e.currentTarget.style.borderColor = 'var(--border)';
                                            e.currentTarget.style.background = 'var(--panel)';
                                        }
                                    }}
                                    onClick={() => setShowBodyTypeDropdown(prev => !prev)}
                                >
                                    <span style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {
                                            bodyType === "json" ? "JSON" :
                                                bodyType === "xml" ? "XML" :
                                                    bodyType === "form" ? "x-www-form-urlencoded" :
                                                        bodyType === "multipart" ? "form-data (simple)" :
                                                            bodyType === "raw" ? "Raw" : "Select Type"
                                        }
                                    </span>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '3px',
                                        background: 'rgba(255,255,255,0.05)',
                                        transition: 'transform 0.3s ease',
                                        transform: showBodyTypeDropdown ? 'rotate(180deg)' : 'rotate(0)'
                                    }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="6 9 12 15 18 9"></polyline>
                                        </svg>
                                    </div>
                                </button>
                                {showBodyTypeDropdown && (
                                    <>
                                        <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setShowBodyTypeDropdown(false)}></div>
                                        <div className="menu" style={{
                                            position: 'absolute',
                                            top: 'calc(100% + 4px)',
                                            left: 0,
                                            width: '200px',
                                            zIndex: 100,
                                            background: 'var(--panel)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '8px',
                                            padding: '4px',
                                            boxShadow: '0 8px 16px rgba(0,0,0,0.2)'
                                        }}>
                                            {[
                                                { value: "json", label: "JSON" },
                                                { value: "xml", label: "XML" },
                                                { value: "form", label: "x-www-form-urlencoded" },
                                                { value: "multipart", label: "form-data (simple)" },
                                                { value: "raw", label: "Raw" }
                                            ].map((opt) => {
                                                const isActive = bodyType === opt.value;
                                                return (
                                                    <button
                                                        key={opt.value}
                                                        style={{
                                                            width: '100%',
                                                            textAlign: 'left',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            padding: '6px 8px',
                                                            fontSize: '12px',
                                                            background: isActive ? 'rgba(46, 211, 198, 0.1)' : 'transparent',
                                                            color: isActive ? 'var(--accent-2)' : 'var(--text)',
                                                            fontWeight: isActive ? 600 : 400,
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer',
                                                            transition: 'background 0.1s'
                                                        }}
                                                        onMouseOver={(e) => {
                                                            if (!isActive) e.currentTarget.style.background = 'var(--panel-2)';
                                                        }}
                                                        onMouseOut={(e) => {
                                                            if (!isActive) e.currentTarget.style.background = 'transparent';
                                                        }}
                                                        onClick={() => {
                                                            setBodyType(opt.value);
                                                            setContentType(opt.value);
                                                            setShowBodyTypeDropdown(false);
                                                        }}
                                                    >
                                                        {opt.label}
                                                        {isActive && (
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                                                <polyline points="20 6 9 17 4 12"></polyline>
                                                            </svg>
                                                        )}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </>
                                )}
                            </div>
                            {(bodyType === "json" || bodyType === "xml") && (
                                <button
                                    className="ghost compact"
                                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                    onClick={() => {
                                        try {
                                            if (bodyType === "json") {
                                                const stripComments = (str) => str.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                                                const parsed = JSON.parse(stripComments(bodyText));
                                                setBodyText(JSON.stringify(parsed, null, 2));
                                            } else if (bodyType === "xml") {
                                                setBodyText(prettifyXml(bodyText));
                                            }
                                        } catch (e) {
                                            // Ignored if invalid
                                        }
                                    }}
                                >
                                    Prettify
                                </button>
                            )}
                            {bodyType === "json" && <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Supports // comments</div>}
                            {(bodyType === "json" || bodyType === "xml" || bodyType === "raw" || bodyType === "form" || bodyType === "multipart") && (
                                <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setIsFullScreen(true)}>Full Screen</button>
                            )}
                        </>
                    )}
                    {activeRequestTab === "Tests" && (
                        <>
                            <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setShowTestOutput((prev) => !prev)}>
                                Output
                            </button>
                            <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setShowTestInput((prev) => !prev)}>
                                Test Input
                            </button>
                            <div className={styles.tabs} style={{ marginBottom: 0 }}>
                                <button
                                    className={testsMode === "pre" ? `${styles.tab} ${styles.active}` : styles.tab}
                                    onClick={() => setTestsMode("pre")}
                                >
                                    Pre-request
                                </button>
                                <button
                                    className={testsMode === "post" ? `${styles.tab} ${styles.active}` : styles.tab}
                                    onClick={() => setTestsMode("post")}
                                >
                                    Post-response
                                </button>
                            </div>
                            <button className="primary compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={runTests}>Run Tests</button>
                        </>
                    )}
                </div>
            </div>

            <div className={styles.editor}>
                {activeRequestTab === "Params" && (
                    <TableEditor
                        rows={paramsRows}
                        onChange={(r) => {
                            setParamsRows(r);
                            if (currentRequestId) updateRequestState(currentRequestId, "paramsRows", r);
                        }}
                        keyPlaceholder="Query Param"
                        valuePlaceholder="Value"
                        envVars={getEnvVars()}
                        onUpdateEnvVar={handleUpdateEnvVar}
                    />
                )}
                {activeRequestTab === "Headers" && (
                    <div className={styles.headersEditor}>
                        {headersMode === "table" && (
                            <TableEditor
                                rows={headersRows}
                                onChange={handleHeadersRowsChange}
                                keyPlaceholder="Header"
                                valuePlaceholder="Value"
                                envVars={getEnvVars()}
                            />
                        )}
                        {headersMode === "json" && (
                            <textarea
                                className={`${styles.textarea} ${styles.fixed}`}
                                value={headersText}
                                onChange={(e) => handleHeadersTextChange(e.target.value)}
                                placeholder="Paste JSON headers here"
                            />
                        )}
                    </div>
                )}
                {activeRequestTab === "Auth" && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Type</span>
                            <div style={{ position: 'relative' }}>
                                <button
                                    style={{
                                        width: '200px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        padding: '4px 10px',
                                        height: '28px',
                                        background: 'var(--panel)',
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                        color: 'var(--text)',
                                        transition: 'all 0.2s ease',
                                        boxShadow: showAuthTypeDropdown ? '0 0 0 2px rgba(46, 211, 198, 0.2)' : '0 2px 4px rgba(0,0,0,0.05)',
                                        borderColor: showAuthTypeDropdown ? 'var(--accent-2)' : 'var(--border)'
                                    }}
                                    onMouseOver={(e) => {
                                        if (!showAuthTypeDropdown) {
                                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                                            e.currentTarget.style.background = 'var(--panel-3)';
                                        }
                                    }}
                                    onMouseOut={(e) => {
                                        if (!showAuthTypeDropdown) {
                                            e.currentTarget.style.borderColor = 'var(--border)';
                                            e.currentTarget.style.background = 'var(--panel)';
                                        }
                                    }}
                                    onClick={() => setShowAuthTypeDropdown(prev => !prev)}
                                >
                                    <span style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {
                                            authType === "none" ? "No Auth" :
                                                authType === "bearer" ? "Bearer Token" :
                                                    authType === "basic" ? "Basic Auth" :
                                                        authType === "api_key" ? "API Key" :
                                                            authType === "custom" ? "Custom (Legacy)" : "Select Auth Type"
                                        }
                                    </span>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '3px',
                                        background: 'rgba(255,255,255,0.05)',
                                        transition: 'transform 0.3s ease',
                                        transform: showAuthTypeDropdown ? 'rotate(180deg)' : 'rotate(0)'
                                    }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="6 9 12 15 18 9"></polyline>
                                        </svg>
                                    </div>
                                </button>
                                {showAuthTypeDropdown && (
                                    <>
                                        <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setShowAuthTypeDropdown(false)}></div>
                                        <div className="menu" style={{
                                            position: 'absolute',
                                            top: 'calc(100% + 4px)',
                                            left: 0,
                                            width: '200px',
                                            zIndex: 100,
                                            background: 'var(--panel)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '8px',
                                            padding: '4px',
                                            boxShadow: '0 8px 16px rgba(0,0,0,0.2)'
                                        }}>
                                            {[
                                                { value: "none", label: "No Auth" },
                                                { value: "bearer", label: "Bearer Token" },
                                                { value: "basic", label: "Basic Auth" },
                                                { value: "api_key", label: "API Key" },
                                                { value: "custom", label: "Custom (Legacy)" }
                                            ].map((opt) => {
                                                const isActive = authType === opt.value;
                                                return (
                                                    <button
                                                        key={opt.value}
                                                        style={{
                                                            width: '100%',
                                                            textAlign: 'left',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            padding: '6px 8px',
                                                            fontSize: '12px',
                                                            background: isActive ? 'rgba(46, 211, 198, 0.1)' : 'transparent',
                                                            color: isActive ? 'var(--accent-2)' : 'var(--text)',
                                                            fontWeight: isActive ? 600 : 400,
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer',
                                                            transition: 'background 0.1s'
                                                        }}
                                                        onMouseOver={(e) => {
                                                            if (!isActive) e.currentTarget.style.background = 'var(--panel-2)';
                                                        }}
                                                        onMouseOut={(e) => {
                                                            if (!isActive) e.currentTarget.style.background = 'transparent';
                                                        }}
                                                        onClick={() => {
                                                            setAuthType(opt.value);
                                                            if (currentRequestId) updateRequestState(currentRequestId, "authType", opt.value);
                                                            setShowAuthTypeDropdown(false);
                                                        }}
                                                    >
                                                        {opt.label}
                                                        {isActive && (
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                                                <polyline points="20 6 9 17 4 12"></polyline>
                                                            </svg>
                                                        )}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                            {authType === "none" && (
                                <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                                    This request does not use any authorization.
                                </div>
                            )}

                            {authType === "bearer" && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Token</span>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="Token"
                                            value={authConfig.bearer?.token || ""}
                                            onChange={(e) => {
                                                const next = { ...authConfig, bearer: { ...authConfig.bearer, token: e.target.value } };
                                                setAuthConfig(next);
                                                if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                            }}
                                        />
                                    </label>
                                </div>
                            )}

                            {authType === "basic" && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Username</span>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="Username"
                                            value={authConfig.basic?.username || ""}
                                            onChange={(e) => {
                                                const next = { ...authConfig, basic: { ...authConfig.basic, username: e.target.value } };
                                                setAuthConfig(next);
                                                if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                            }}
                                        />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Password</span>
                                        <input
                                            type="password"
                                            className="input"
                                            placeholder="Password"
                                            value={authConfig.basic?.password || ""}
                                            onChange={(e) => {
                                                const next = { ...authConfig, basic: { ...authConfig.basic, password: e.target.value } };
                                                setAuthConfig(next);
                                                if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                            }}
                                        />
                                    </label>
                                </div>
                            )}

                            {authType === "api_key" && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Key</span>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="Key"
                                            value={authConfig.api_key?.key || ""}
                                            onChange={(e) => {
                                                const next = { ...authConfig, api_key: { ...authConfig.api_key, key: e.target.value } };
                                                setAuthConfig(next);
                                                if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                            }}
                                        />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Value</span>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="Value"
                                            value={authConfig.api_key?.value || ""}
                                            onChange={(e) => {
                                                const next = { ...authConfig, api_key: { ...authConfig.api_key, value: e.target.value } };
                                                setAuthConfig(next);
                                                if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                            }}
                                        />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Add to</span>
                                        <select
                                            className="input compact"
                                            value={authConfig.api_key?.add_to || "header"}
                                            onChange={(e) => {
                                                const next = { ...authConfig, api_key: { ...authConfig.api_key, add_to: e.target.value } };
                                                setAuthConfig(next);
                                                if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                            }}
                                        >
                                            <option value="header">Header</option>
                                            <option value="query">Query Params</option>
                                        </select>
                                    </label>
                                </div>
                            )}

                            {authType === "custom" && (
                                <TableEditor
                                    rows={authRows}
                                    onChange={(r) => {
                                        setAuthRows(r);
                                        if (currentRequestId) updateRequestState(currentRequestId, "authRows", r);
                                    }}
                                    keyPlaceholder="Custom Key"
                                    valuePlaceholder="Credentials"
                                    envVars={getEnvVars()}
                                    onUpdateEnvVar={handleUpdateEnvVar}
                                />
                            )}
                        </div>
                    </div>
                )}
                {activeRequestTab === "Body" && (() => {
                    const bodyActions = (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <select
                                className="input compact"
                                value={bodyType}
                                onChange={(e) => {
                                    setBodyType(e.target.value);
                                    setContentType(e.target.value);
                                }}
                            >
                                <option value="json">JSON</option>
                                <option value="xml">XML</option>
                                <option value="form">x-www-form-urlencoded</option>
                                <option value="multipart">form-data (simple)</option>
                                <option value="raw">Raw</option>
                            </select>
                            {(bodyType === "json" || bodyType === "xml") && (
                                <button
                                    className="ghost compact"
                                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                    onClick={() => {
                                        try {
                                            if (bodyType === "json") {
                                                const stripComments = (str) => str.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                                                const parsed = JSON.parse(stripComments(bodyText));
                                                setBodyText(JSON.stringify(parsed, null, 2));
                                            } else if (bodyType === "xml") {
                                                setBodyText(prettifyXml(bodyText));
                                            }
                                        } catch (e) {
                                            // Ignored if invalid
                                        }
                                    }}
                                >
                                    Prettify
                                </button>
                            )}
                            {bodyType === "json" && <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Supports // comments</div>}
                        </div>
                    );

                    const bodyEditorContent = (
                        <div
                            className={styles.bodyEditor}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}
                        >
                            {(bodyType === "json" || bodyType === "xml" || bodyType === "raw") && (() => {
                                const envAutoComplete = createEnvAutoComplete(getEnvVars);
                                const envHoverTooltip = createEnvHoverTooltip(getEnvVars, setCmEnvEdit);

                                return (
                                    <div style={{ flex: 1, overflow: 'auto', border: isFullScreen ? 'none' : '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                        <CodeMirror
                                            value={bodyText}
                                            height="100%"
                                            theme={vscodeDark}
                                            extensions={
                                                bodyType === "json"
                                                    ? [json(), customJsonLinter, lintGutter(), envAutoComplete, envVarHighlightPlugin, envHoverTooltip, search()]
                                                    : bodyType === "xml"
                                                        ? [xmlLang(), xmlLinter, lintGutter(), envAutoComplete, envVarHighlightPlugin, envHoverTooltip, search()]
                                                        : [envAutoComplete, envVarHighlightPlugin, envHoverTooltip, search()]
                                            }
                                            onChange={(value) => setBodyText(value)}
                                            basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                                        />
                                    </div>
                                );
                            })()}
                            {(bodyType === "form" || bodyType === "multipart") && (
                                <TableEditor
                                    rows={bodyRows}
                                    onChange={(r) => {
                                        setBodyRows(r);
                                        if (currentRequestId) updateRequestState(currentRequestId, "bodyRows", r);
                                    }}
                                    keyPlaceholder="Field"
                                    valuePlaceholder="Value"
                                    envVars={getEnvVars()}
                                />
                            )}
                        </div>
                    );

                    return (
                        <>
                            {!isFullScreen && bodyEditorContent}
                            <FullScreenModal isOpen={isFullScreen} onClose={() => setIsFullScreen(false)} title="Request Body" actions={bodyActions}>
                                {bodyEditorContent}
                            </FullScreenModal>
                        </>
                    );
                })()}
                {activeRequestTab === "Tests" && (
                    <div className={styles.testsEditor}>
                        {showTestInput && (
                            <div className={styles.testsInputInline}>
                                <div className="panel-title">Test Input (JSON)</div>
                                <textarea
                                    className={`${styles.textarea} ${styles.compact}`}
                                    value={testsInputText}
                                    onChange={(e) => setTestsInputText(e.target.value)}
                                />
                            </div>
                        )}
                        {testsMode === "pre" && (
                            <textarea
                                className={`${styles.textarea} ${styles.fixed}`}
                                value={testsPreText}
                                onChange={(e) => setTestsPreText(e.target.value)}
                            />
                        )}
                        {testsMode === "post" && (
                            <textarea
                                className={`${styles.textarea} ${styles.fixed}`}
                                value={testsPostText}
                                onChange={(e) => setTestsPostText(e.target.value)}
                            />
                        )}
                        {showTestOutput && (
                            <div className={styles.testsOutput}>
                                {testsOutput.map((entry, index) => (
                                    <div className={`log ${entry.type}`} key={index}>
                                        <span className="log-label">{entry.label || "script"}&gt;</span>
                                        {entry.type === "pass" && <span className="log-type">PASS</span>}
                                        {entry.type === "fail" && <span className="log-type">FAIL</span>}
                                        {entry.type === "error" && <span className="log-type">ERROR</span>}
                                        {entry.type === "info" && <span className="log-type">INFO</span>}
                                        {entry.type === "log" && <span className="log-type">LOG</span>}
                                        <span className="log-text">{entry.text}</span>
                                        {entry.errorType && <span className="log-error">({entry.errorType}{entry.errorMessage ? `: ${entry.errorMessage}` : ""})</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
