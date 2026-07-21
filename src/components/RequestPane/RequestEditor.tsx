import React, { useState } from "react";

import { EnvInput } from "../TableEditor";
import styles from "./RequestEditor.module.css";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequestToolbar } from "./RequestToolbar";
import { RequestTabs } from "./RequestTabs";
import { BodyTab } from "./tabs/BodyTab";
import { AuthTab } from "./tabs/AuthTab";
import { ParamsTab } from "./tabs/ParamsTab";
import { HeadersTab } from "./tabs/HeadersTab";
import { TestsTab } from "./tabs/TestsTab";
import type { Theme } from "../../theme/theme";
import type { AutoHeader } from "../../utils/autoHeaders";
import { ScriptStep } from "../../services/scriptSteps";

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
    autoHeaders: AutoHeader[];
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
    testsPreSteps: ScriptStep[];
    setTestsPreSteps: (next: ScriptStep[]) => void;
    testsPostSteps: ScriptStep[];
    setTestsPostSteps: (next: ScriptStep[]) => void;
    vizScriptText: string;
    setVizScriptText: (text: string) => void;
    runVizScript: () => void;
    testsOutput: any;
    handleCancelSend: () => void;
    theme: Theme;
    onCurlPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
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
    autoHeaders,
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
    testsPreSteps,
    setTestsPreSteps,
    testsPostSteps,
    setTestsPostSteps,
    vizScriptText,
    setVizScriptText,
    runVizScript,
    testsOutput,
    handleCancelSend,
    theme,
    onCurlPaste
}: RequestEditorProps) {
    const [showBodyTypeDropdown, setShowBodyTypeDropdown] = useState(false);

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
                        onPaste={onCurlPaste}
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
                </div>
            </div>

            <div className={styles.editor}>
                {activeRequestTab === "Params" && (
                    <ParamsTab
                        paramsRows={paramsRows}
                        setParamsRows={setParamsRows}
                        currentRequestId={currentRequestId}
                        updateRequestState={updateRequestState}
                        getEnvVars={getEnvVars}
                        handleUpdateEnvVar={handleUpdateEnvVar}
                    />
                )}
                {activeRequestTab === "Headers" && (
                    <HeadersTab
                        headersMode={headersMode}
                        setHeadersMode={setHeadersMode}
                        headersRows={headersRows}
                        handleHeadersRowsChange={handleHeadersRowsChange}
                        headersText={headersText}
                        handleHeadersTextChange={handleHeadersTextChange}
                        autoHeaders={autoHeaders}
                        getEnvVars={getEnvVars}
                        theme={theme}
                    />
                )}
                {activeRequestTab === "Auth" && (
                    <AuthTab
                        authType={authType}
                        setAuthType={setAuthType}
                        authConfig={authConfig}
                        setAuthConfig={setAuthConfig}
                        authRows={authRows}
                        setAuthRows={setAuthRows}
                        currentRequestId={currentRequestId}
                        updateRequestState={updateRequestState}
                        getEnvVars={getEnvVars}
                        handleUpdateEnvVar={handleUpdateEnvVar}
                    />
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
                    <TestsTab
                        showTestOutput={showTestOutput}
                        setShowTestOutput={setShowTestOutput}
                        showTestInput={showTestInput}
                        setShowTestInput={setShowTestInput}
                        testsMode={testsMode}
                        setTestsMode={setTestsMode}
                        runTests={runTests}
                        testsInputText={testsInputText}
                        setTestsInputText={setTestsInputText}
                        testsPreSteps={testsPreSteps}
                        setTestsPreSteps={setTestsPreSteps}
                        testsPostSteps={testsPostSteps}
                        setTestsPostSteps={setTestsPostSteps}
                        vizScriptText={vizScriptText}
                        setVizScriptText={setVizScriptText}
                        runVizScript={runVizScript}
                        testsOutput={testsOutput}
                        theme={theme}
                    />
                )}
            </div>
        </section>
    );
}
