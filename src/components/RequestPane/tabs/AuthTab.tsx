import { useState } from "react";

import { TableEditor, EnvInput } from "../../TableEditor";
import { Select } from "../../ui/UiSelect";
import { Button } from "../../ui/AppButton";
import styles from "./AuthTab.module.css";

const AUTH_TYPE_OPTIONS = [
    { value: "none", label: "No Auth", color: "var(--text)" },
    { value: "bearer", label: "Bearer Token", color: "var(--text)" },
    { value: "basic", label: "Basic Auth", color: "var(--text)" },
    { value: "api_key", label: "API Key", color: "var(--text)" },
    { value: "custom", label: "Custom (Legacy)", color: "var(--text)" }
];

const ADD_TO_OPTIONS = [
    { value: "header", label: "Header", color: "var(--text)" },
    { value: "query", label: "Query Params", color: "var(--text)" }
];

const EyeOffIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
);

const EyeIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
);

interface AuthTabProps {
    authType: string;
    setAuthType: (type: string) => void;
    authConfig: any;
    setAuthConfig: (config: any) => void;
    authRows: any[];
    setAuthRows: (rows: any[]) => void;
    currentRequestId: string;
    updateRequestState: (id: string, key: string, val: any) => void;
    getEnvVars: () => any;
    handleUpdateEnvVar: (key: string, val: string) => void;
}

export function AuthTab({
    authType,
    setAuthType,
    authConfig,
    setAuthConfig,
    authRows,
    setAuthRows,
    currentRequestId,
    updateRequestState,
    getEnvVars,
    handleUpdateEnvVar
}: AuthTabProps) {
    const [showBearerToken, setShowBearerToken] = useState(false);
    const [showBasicPassword, setShowBasicPassword] = useState(false);
    const [showApiKeyValue, setShowApiKeyValue] = useState(false);

    return (
        <div className={styles.wrapper}>
            <div className={styles.typeRow}>
                <span className={styles.typeLabel}>Type</span>
                <Select
                    value={authType}
                    onChange={(val) => {
                        setAuthType(val);
                        if (currentRequestId) updateRequestState(currentRequestId, "authType", val);
                    }}
                    options={AUTH_TYPE_OPTIONS}
                    placeholder="Select Auth Type"
                />
            </div>

            <div className={styles.body}>
                {authType === "none" && (
                    <div className={styles.noAuth}>
                        This request does not use any authorization.
                    </div>
                )}

                {authType === "bearer" && (
                    <div className={styles.fieldGroup}>
                        <label className={styles.field}>
                            <span className={styles.fieldLabel}>Token</span>
                            <div className={styles.maskedInputRow}>
                                <EnvInput
                                    className={`input ${styles.maskedInput}`}
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
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className={styles.toggleButton}
                                    onClick={() => setShowBearerToken(prev => !prev)}
                                    title={showBearerToken ? "Hide token" : "Show token"}
                                >
                                    {showBearerToken ? <EyeOffIcon /> : <EyeIcon />}
                                </Button>
                            </div>
                        </label>
                    </div>
                )}

                {authType === "basic" && (
                    <div className={styles.fieldGroup}>
                        <label className={styles.field}>
                            <span className={styles.fieldLabel}>Username</span>
                            <EnvInput
                                className={`input ${styles.plainInput}`}
                                placeholder="Username"
                                value={authConfig.basic?.username || ""}
                                onChange={(val) => {
                                    const next = { ...authConfig, basic: { ...authConfig.basic, username: val } };
                                    setAuthConfig(next);
                                    if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                }}
                                envVars={getEnvVars()}
                                onUpdateEnvVar={handleUpdateEnvVar}
                            />
                        </label>
                        <label className={styles.field}>
                            <span className={styles.fieldLabel}>Password</span>
                            <div className={styles.maskedInputRow}>
                                <EnvInput
                                    className={`input ${styles.maskedInput}`}
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
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className={styles.toggleButton}
                                    onClick={() => setShowBasicPassword(prev => !prev)}
                                    title={showBasicPassword ? "Hide password" : "Show password"}
                                >
                                    {showBasicPassword ? <EyeOffIcon /> : <EyeIcon />}
                                </Button>
                            </div>
                        </label>
                    </div>
                )}

                {authType === "api_key" && (
                    <div className={styles.fieldGroup}>
                        <label className={styles.field}>
                            <span className={styles.fieldLabel}>Key</span>
                            <EnvInput
                                className={`input ${styles.plainInput}`}
                                placeholder="Key"
                                value={authConfig.api_key?.key || ""}
                                onChange={(val) => {
                                    const next = { ...authConfig, api_key: { ...authConfig.api_key, key: val } };
                                    setAuthConfig(next);
                                    if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                }}
                                envVars={getEnvVars()}
                                onUpdateEnvVar={handleUpdateEnvVar}
                            />
                        </label>
                        <label className={styles.field}>
                            <span className={styles.fieldLabel}>Value</span>
                            <div className={styles.maskedInputRow}>
                                <EnvInput
                                    className={`input ${styles.maskedInput}`}
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
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className={styles.toggleButton}
                                    onClick={() => setShowApiKeyValue(prev => !prev)}
                                    title={showApiKeyValue ? "Hide value" : "Show value"}
                                >
                                    {showApiKeyValue ? <EyeOffIcon /> : <EyeIcon />}
                                </Button>
                            </div>
                        </label>
                        <label className={styles.field}>
                            <span className={styles.fieldLabel}>Add to</span>
                            <Select
                                value={authConfig.api_key?.add_to || "header"}
                                onChange={(val) => {
                                    const next = { ...authConfig, api_key: { ...authConfig.api_key, add_to: val } };
                                    setAuthConfig(next);
                                    if (currentRequestId) updateRequestState(currentRequestId, "authConfig", next);
                                }}
                                options={ADD_TO_OPTIONS}
                            />
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
    );
}
