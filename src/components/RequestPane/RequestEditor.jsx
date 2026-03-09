import React, { useState } from "react";
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json } from '@codemirror/lang-json';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { lintGutter } from '@codemirror/lint';

import { xmlLinter } from "../../utils/codemirror/xmlExtensions.js";
import { customJsonLinter } from "../../utils/codemirror/jsonExtensions.js";
import { envVarHighlightPlugin, createEnvAutoComplete, createEnvHoverTooltip } from "../../utils/codemirror/environmentExtensions.js";
import { search, openSearchPanel } from '@codemirror/search';
import { keymap } from '@codemirror/view';

const searchWithReplace = () => [
    search({ top: true }),
    keymap.of([{ key: "Mod-r", run: (view) => { openSearchPanel(view); return true; } }])
];

import { TableEditor } from "../TableEditor.jsx";
import { EnvInput } from "../TableEditor.jsx";
import { FullScreenModal } from "../Modals/FullScreenModal.jsx";
import { prettifyXml } from "../../services/format.js";
import styles from "./RequestEditor.module.css";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    const [showBearerToken, setShowBearerToken] = useState(false);
    const [showApiKeyValue, setShowApiKeyValue] = useState(false);

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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                </button>
            </div>
            <div className={styles.requestBar}>
                <Select value={method} onValueChange={(val) => {
                    setMethod(val);
                    if (currentRequestId) updateRequestMethod(currentRequestId, val);
                }}>
                    <SelectTrigger className="w-[100px] h-[36px] bg-panel-2 border-border text-foreground font-semibold">
                        <SelectValue placeholder="Method" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="GET" className="font-semibold text-[var(--ok)]">GET</SelectItem>
                        <SelectItem value="POST" className="font-semibold text-[var(--warn)]">POST</SelectItem>
                        <SelectItem value="PUT" className="font-semibold text-[var(--info)]">PUT</SelectItem>
                        <SelectItem value="DELETE" className="font-semibold text-[var(--error)]">DELETE</SelectItem>
                    </SelectContent>
                </Select>
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
                            <Select value={bodyType} onValueChange={(val) => {
                                setBodyType(val);
                                setContentType(val);
                            }}>
                                <SelectTrigger className="w-[180px] h-[28px] text-[12px] bg-panel border-border text-foreground">
                                    <SelectValue placeholder="Select Type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="json">JSON</SelectItem>
                                    <SelectItem value="xml">XML</SelectItem>
                                    <SelectItem value="form">x-www-form-urlencoded</SelectItem>
                                    <SelectItem value="multipart">form-data (simple)</SelectItem>
                                    <SelectItem value="raw">Raw</SelectItem>
                                </SelectContent>
                            </Select>
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
                            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <CodeMirror
                                    value={headersText}
                                    theme={vscodeDark}
                                    extensions={[json(), customJsonLinter, lintGutter(), ...searchWithReplace()]}
                                    onChange={(value) => handleHeadersTextChange(value)}
                                    basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                                    placeholder="Paste JSON headers here"
                                />
                            </div>
                        )}
                    </div>
                )}
                {activeRequestTab === "Auth" && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Type</span>
                            <Select value={authType} onValueChange={(val) => {
                                setAuthType(val);
                                if (currentRequestId) updateRequestState(currentRequestId, "authType", val);
                            }}>
                                <SelectTrigger className="w-[200px] h-[28px] text-[12px] bg-panel border-border text-foreground">
                                    <SelectValue placeholder="Select Auth Type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">No Auth</SelectItem>
                                    <SelectItem value="bearer">Bearer Token</SelectItem>
                                    <SelectItem value="basic">Basic Auth</SelectItem>
                                    <SelectItem value="api_key">API Key</SelectItem>
                                    <SelectItem value="custom">Custom (Legacy)</SelectItem>
                                </SelectContent>
                            </Select>
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
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <input
                                                type={showBearerToken ? "text" : "password"}
                                                className="input"
                                                placeholder="Token"
                                                value={authConfig.bearer?.token || ""}
                                                onChange={(e) => {
                                                    const next = { ...authConfig, bearer: { ...authConfig.bearer, token: e.target.value } };
                                                    setAuthConfig(next);
                                                    if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                                }}
                                                style={{ paddingRight: '36px' }}
                                            />
                                            <button
                                                type="button"
                                                className="ghost icon-button"
                                                onClick={() => setShowBearerToken(prev => !prev)}
                                                title={showBearerToken ? "Hide token" : "Show token"}
                                                style={{ position: 'absolute', right: '4px', padding: '4px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                                            >
                                                {showBearerToken ? (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                                ) : (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                                )}
                                            </button>
                                        </div>
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
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <input
                                                type={showApiKeyValue ? "text" : "password"}
                                                className="input"
                                                placeholder="Value"
                                                value={authConfig.api_key?.value || ""}
                                                onChange={(e) => {
                                                    const next = { ...authConfig, api_key: { ...authConfig.api_key, value: e.target.value } };
                                                    setAuthConfig(next);
                                                    if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                                }}
                                                style={{ paddingRight: '36px' }}
                                            />
                                            <button
                                                type="button"
                                                className="ghost icon-button"
                                                onClick={() => setShowApiKeyValue(prev => !prev)}
                                                title={showApiKeyValue ? "Hide value" : "Show value"}
                                                style={{ position: 'absolute', right: '4px', padding: '4px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                                            >
                                                {showApiKeyValue ? (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                                ) : (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                                )}
                                            </button>
                                        </div>
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
                                    isMaskable
                                />
                            )}
                        </div>
                    </div>
                )}
                {activeRequestTab === "Body" && (() => {
                    const bodyActions = (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Select value={bodyType} onValueChange={(val) => {
                                setBodyType(val);
                                setContentType(val);
                            }}>
                                <SelectTrigger className="w-[180px] h-[28px] text-[12px] bg-panel border-border text-foreground">
                                    <SelectValue placeholder="Select Type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="json">JSON</SelectItem>
                                    <SelectItem value="xml">XML</SelectItem>
                                    <SelectItem value="form">x-www-form-urlencoded</SelectItem>
                                    <SelectItem value="multipart">form-data (simple)</SelectItem>
                                    <SelectItem value="raw">Raw</SelectItem>
                                </SelectContent>
                            </Select>
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
                                                    ? [json(), customJsonLinter, lintGutter(), envAutoComplete, envVarHighlightPlugin, envHoverTooltip, ...searchWithReplace()]
                                                    : bodyType === "xml"
                                                        ? [xmlLang(), xmlLinter, lintGutter(), envAutoComplete, envVarHighlightPlugin, envHoverTooltip, ...searchWithReplace()]
                                                        : [envAutoComplete, envVarHighlightPlugin, envHoverTooltip, ...searchWithReplace()]
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
                                <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: '100px' }}>
                                    <CodeMirror
                                        value={testsInputText}
                                        theme={vscodeDark}
                                        extensions={[json(), customJsonLinter, lintGutter(), ...searchWithReplace()]}
                                        onChange={(value) => setTestsInputText(value)}
                                        basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                                    />
                                </div>
                            </div>
                        )}
                        {testsMode === "pre" && (
                            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <CodeMirror
                                    value={testsPreText}
                                    theme={vscodeDark}
                                    extensions={[javascript(), ...searchWithReplace()]}
                                    onChange={(value) => setTestsPreText(value)}
                                    basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                                    placeholder="// Pre-request script (JavaScript)"
                                />
                            </div>
                        )}
                        {testsMode === "post" && (
                            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <CodeMirror
                                    value={testsPostText}
                                    theme={vscodeDark}
                                    extensions={[javascript(), ...searchWithReplace()]}
                                    onChange={(value) => setTestsPostText(value)}
                                    basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                                    placeholder="// Post-response script (JavaScript)"
                                />
                            </div>
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


