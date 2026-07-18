import React, { useState } from "react";
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { lintGutter } from '@codemirror/lint';

import { customJsonLinter } from "../../utils/codemirror/jsonExtensions";
import { search } from '@codemirror/search';
import { createCustomSearchPanel, customSearchKeymap } from "../../utils/codemirror/customSearchPanel";

const searchWithReplace = () => [
    search({ top: true, createPanel: createCustomSearchPanel }),
    customSearchKeymap
];

import { TableEditor, EnvInput } from "../TableEditor";
import styles from "./RequestEditor.module.css";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequestToolbar } from "./RequestToolbar";
import { RequestTabs } from "./RequestTabs";
import { BodyTab } from "./tabs/BodyTab";
import type { Theme } from "../../theme/theme";

interface RequestEditorProps {
    editingMainRequestName: boolean;
    setEditingMainRequestName: (val: boolean) => void;
    requestName: string;
    setRequestName: (val: string) => void;
    currentRequestId: string;
    updateRequestName: (id: string, name: string) => void;
    setShowSnippetModal: (val: boolean) => void;
    method: string;
    setMethod: (val: string) => void;
    updateRequestMethod: (id: string, method: string) => void;
    url: string;
    setUrl: (val: string) => void;
    getEnvVars: () => any;
    handleUpdateEnvVar: (key: string, val: string) => void;
    handleSend: () => void;
    isSending: boolean;
    requestTabs: string[];
    activeRequestTab: string;
    setActiveRequestTab: (tab: string) => void;
    headersMode: string;
    setHeadersMode: (mode: string) => void;
    bodyType: string;
    setBodyType: (type: string) => void;
    setContentType: (type: string) => void;
    bodyText: string;
    setBodyText: (text: string) => void;
    showTestOutput: boolean;
    setShowTestOutput: (val: boolean | ((prev: boolean) => boolean)) => void;
    showTestInput: boolean;
    setShowTestInput: (val: boolean | ((prev: boolean) => boolean)) => void;
    testsMode: string;
    setTestsMode: (mode: string) => void;
    runTests: () => void;
    paramsRows: any[];
    setParamsRows: (rows: any[]) => void;
    updateRequestState: (id: string, key: string, val: any) => void;
    headersRows: any[];
    handleHeadersRowsChange: (rows: any[]) => void;
    headersText: string;
    handleHeadersTextChange: (text: string) => void;
    authType: string;
    setAuthType: (type: string) => void;
    authConfig: any;
    setAuthConfig: (config: any) => void;
    authRows: any[];
    setAuthRows: (rows: any[]) => void;
    httpVersion: string;
    setHttpVersion: (version: string) => void;
    requestTimeoutMs: number;
    setRequestTimeoutMs: (timeout: number) => void;
    setCmEnvEdit: (edit: any) => void;
    bodyRows: any[];
    setBodyRows: (rows: any[]) => void;
    testsInputText: string;
    setTestsInputText: (text: string) => void;
    testsPreText: string;
    setTestsPreText: (text: string) => void;
    testsPostText: string;
    setTestsPostText: (text: string) => void;
    testsOutput: any;
    handleCancelSend: () => void;
    theme: Theme;
}

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
    httpVersion,
    setHttpVersion,
    requestTimeoutMs,
    setRequestTimeoutMs,
    setCmEnvEdit,
    bodyRows,
    setBodyRows,
    testsInputText,
    setTestsInputText,
    testsPreText,
    setTestsPreText,
    testsPostText,
    setTestsPostText,
    testsOutput,
    handleCancelSend,
    theme
}: RequestEditorProps) {
    const [showBodyTypeDropdown, setShowBodyTypeDropdown] = useState(false);
    const [showAuthTypeDropdown, setShowAuthTypeDropdown] = useState(false);
    const [showBearerToken, setShowBearerToken] = useState(false);
    const [showBasicPassword, setShowBasicPassword] = useState(false);
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
            <RequestToolbar
                method={method}
                onMethodChange={(val) => {
                    setMethod(val);
                    if (currentRequestId) updateRequestMethod(currentRequestId, val);
                }}
                sending={isSending}
                onSend={handleSend}
                onCancel={handleCancelSend}
                urlField={
                    <EnvInput
                        className={`input ${styles.url} h-[30px]`}
                        value={url}
                        onChange={(val) => {
                            setUrl(val);
                            if (currentRequestId) updateRequestState(currentRequestId, "url", val);
                        }}
                        envVars={getEnvVars()}
                        onUpdateEnvVar={handleUpdateEnvVar}
                        placeholder="https://api.example.com/v1/users/{{id}}"
                        style={{ flex: 1 }}
                    />
                }
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <RequestTabs active={activeRequestTab} tabs={requestTabs} onChange={setActiveRequestTab} />
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Select value={httpVersion} onValueChange={(val) => {
                        setHttpVersion(val);
                        if (currentRequestId) updateRequestState(currentRequestId, "httpVersion", val);
                    }}>
                        <SelectTrigger className="w-[128px] h-[28px] text-[12px] bg-panel border-border text-foreground">
                            <SelectValue placeholder="HTTP" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="1.1">HTTP/1.1</SelectItem>
                            <SelectItem value="2">HTTP/2</SelectItem>
                        </SelectContent>
                    </Select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Timeout</span>
                        <Input
                            value={requestTimeoutMs}
                            type="number"
                            min="1000"
                            step="500"
                            className="w-[104px] h-[28px] text-[12px] bg-panel border-border text-foreground"
                            onChange={(e) => {
                                const nextValue = Number(e.target.value) || 30000;
                                setRequestTimeoutMs(nextValue);
                                if (currentRequestId) updateRequestState(currentRequestId, "requestTimeoutMs", nextValue);
                            }}
                        />
                    </div>
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
                            <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                                            <EnvInput
                                                className="input"
                                                placeholder="Token"
                                                value={authConfig.bearer?.token || ""}
                                                onChange={(val) => {
                                                    const next = { ...authConfig, bearer: { ...authConfig.bearer, token: val } };
                                                    setAuthConfig(next);
                                                    if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                                }}
                                                envVars={getEnvVars()}
                                                onUpdateEnvVar={handleUpdateEnvVar}
                                                maskLiterals={!showBearerToken}
                                                style={{ flex: 1, paddingRight: '36px' }}
                                            />
                                            <button
                                                type="button"
                                                className="ghost icon-button"
                                                onClick={() => setShowBearerToken(prev => !prev)}
                                                title={showBearerToken ? "Hide token" : "Show token"}
                                                style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', padding: '4px', lineHeight: 1, display: 'flex', alignItems: 'center', zIndex: 10 }}
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
                                        <EnvInput
                                            className="input"
                                            placeholder="Username"
                                            value={authConfig.basic?.username || ""}
                                            onChange={(val) => {
                                                const next = { ...authConfig, basic: { ...authConfig.basic, username: val } };
                                                setAuthConfig(next);
                                                if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                            }}
                                            envVars={getEnvVars()}
                                            onUpdateEnvVar={handleUpdateEnvVar}
                                            style={{ flex: 1 }}
                                        />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Password</span>
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <EnvInput
                                                className="input"
                                                placeholder="Password"
                                                value={authConfig.basic?.password || ""}
                                                onChange={(val) => {
                                                    const next = { ...authConfig, basic: { ...authConfig.basic, password: val } };
                                                    setAuthConfig(next);
                                                    if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                                }}
                                                envVars={getEnvVars()}
                                                onUpdateEnvVar={handleUpdateEnvVar}
                                                maskLiterals={!showBasicPassword}
                                                style={{ flex: 1, paddingRight: '36px' }}
                                            />
                                            <button
                                                type="button"
                                                className="ghost icon-button"
                                                onClick={() => setShowBasicPassword(prev => !prev)}
                                                title={showBasicPassword ? "Hide password" : "Show password"}
                                                style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', padding: '4px', lineHeight: 1, display: 'flex', alignItems: 'center', zIndex: 10 }}
                                            >
                                                {showBasicPassword ? (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                                ) : (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                                )}
                                            </button>
                                        </div>
                                    </label>
                                </div>
                            )}

                            {authType === "api_key" && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Key</span>
                                        <EnvInput
                                            className="input"
                                            placeholder="Key"
                                            value={authConfig.api_key?.key || ""}
                                            onChange={(val) => {
                                                const next = { ...authConfig, api_key: { ...authConfig.api_key, key: val } };
                                                setAuthConfig(next);
                                                if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                            }}
                                            envVars={getEnvVars()}
                                            onUpdateEnvVar={handleUpdateEnvVar}
                                            style={{ flex: 1 }}
                                        />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        <span style={{ fontWeight: 500 }}>Value</span>
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <EnvInput
                                                className="input"
                                                placeholder="Value"
                                                value={authConfig.api_key?.value || ""}
                                                onChange={(val) => {
                                                    const next = { ...authConfig, api_key: { ...authConfig.api_key, value: val } };
                                                    setAuthConfig(next);
                                                    if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                                }}
                                                envVars={getEnvVars()}
                                                onUpdateEnvVar={handleUpdateEnvVar}
                                                maskLiterals={!showApiKeyValue}
                                                style={{ flex: 1, paddingRight: '36px' }}
                                            />
                                            <button
                                                type="button"
                                                className="ghost icon-button"
                                                onClick={() => setShowApiKeyValue(prev => !prev)}
                                                title={showApiKeyValue ? "Hide value" : "Show value"}
                                                style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', padding: '4px', lineHeight: 1, display: 'flex', alignItems: 'center', zIndex: 10 }}
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
                {activeRequestTab === "Body" && (
                    <BodyTab
                        theme={theme}
                        bodyType={bodyType}
                        setBodyType={setBodyType}
                        setContentType={setContentType}
                        bodyText={bodyText}
                        setBodyText={setBodyText}
                        bodyRows={bodyRows}
                        setBodyRows={setBodyRows}
                        currentRequestId={currentRequestId}
                        updateRequestState={updateRequestState}
                        getEnvVars={getEnvVars}
                        handleUpdateEnvVar={handleUpdateEnvVar}
                        setCmEnvEdit={setCmEnvEdit}
                    />
                )}
                {activeRequestTab === "Tests" && (
                    <div className={styles.testsEditor}>
                        {showTestInput && (
                            <div className={styles.testsInputInline}>
                                <div className="panel-title">Test Input (JSON)</div>
                                <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: '100px' }}>
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
                            <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                            <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                                {testsOutput.map((entry: any, index: number) => (
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
