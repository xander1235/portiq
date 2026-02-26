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

    return (
        <section className="request">
            <div className="request-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <div className="request-bar">
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
                    className="input url"
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
                <div className="tabs" style={{ marginBottom: 0 }}>
                    {requestTabs.map((tab) => (
                        <button
                            key={tab}
                            className={tab === activeRequestTab ? "tab active" : "tab"}
                            onClick={() => setActiveRequestTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {activeRequestTab === "Headers" && (
                        <div className="tabs" style={{ marginBottom: 0 }}>
                            <button
                                className={headersMode === "table" ? "tab active" : "tab"}
                                onClick={() => setHeadersMode("table")}
                            >
                                Table
                            </button>
                            <button
                                className={headersMode === "json" ? "tab active" : "tab"}
                                onClick={() => setHeadersMode("json")}
                            >
                                JSON
                            </button>
                        </div>
                    )}
                    {activeRequestTab === "Body" && (
                        <>
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
                            <div className="tabs" style={{ marginBottom: 0 }}>
                                <button
                                    className={testsMode === "pre" ? "tab active" : "tab"}
                                    onClick={() => setTestsMode("pre")}
                                >
                                    Pre-request
                                </button>
                                <button
                                    className={testsMode === "post" ? "tab active" : "tab"}
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

            <div className="editor">
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
                    <div className="headers-editor">
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
                                className="textarea fixed"
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
                            <select
                                className="input compact"
                                style={{ width: '200px' }}
                                value={authType}
                                onChange={(e) => {
                                    setAuthType(e.target.value);
                                    if (currentRequestId) updateRequestState(currentRequestId, "authType", e.target.value);
                                }}
                            >
                                <option value="none">No Auth</option>
                                <option value="bearer">Bearer Token</option>
                                <option value="basic">Basic Auth</option>
                                <option value="api_key">API Key</option>
                                <option value="custom">Custom (Legacy)</option>
                            </select>
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
                            className="body-editor"
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
                    <div className="tests-editor">
                        {showTestInput && (
                            <div className="tests-input-inline">
                                <div className="panel-title">Test Input (JSON)</div>
                                <textarea
                                    className="textarea compact"
                                    value={testsInputText}
                                    onChange={(e) => setTestsInputText(e.target.value)}
                                />
                            </div>
                        )}
                        {testsMode === "pre" && (
                            <textarea
                                className="textarea fixed"
                                value={testsPreText}
                                onChange={(e) => setTestsPreText(e.target.value)}
                            />
                        )}
                        {testsMode === "post" && (
                            <textarea
                                className="textarea fixed"
                                value={testsPostText}
                                onChange={(e) => setTestsPostText(e.target.value)}
                            />
                        )}
                        {showTestOutput && (
                            <div className="tests-output">
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
