import { useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

export interface EnvVar {
    key: string;
    value: string;
    comment: string;
    enabled: boolean;
    secret?: boolean;
}

export interface Environment {
    id: string;
    name: string;
    vars: EnvVar[];
}

export function useEnvironmentState() {
    const [environments, setEnvironments] = useLocalStorage<Environment[]>("ui_environments", [
        {
            id: "env-default",
            name: "Local",
            vars: [{ key: "baseUrl", value: "https://api.example.com", comment: "", enabled: true }]
        }
    ]);
    const [activeEnvId, setActiveEnvId] = useLocalStorage<string | null>("ui_activeEnvId", null);

    const [showEnvModal, setShowEnvModal] = useState(false);
    const [selectedEnvIds, setSelectedEnvIds] = useState<string[]>([]);
    const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
    const [editingEnvDraft, setEditingEnvDraft] = useState("");
    const [cmEnvEdit, setCmEnvEdit] = useState<any>(null);

    function getActiveEnv(): Environment | null {
        if (!Array.isArray(environments) || environments.length === 0) return null;
        if (activeEnvId === null) return null;
        return environments.find((env) => env.id === activeEnvId) || null;
    }

    function getEnvVars(): Record<string, string> {
        const env = getActiveEnv();
        if (!env) return {};
        return env.vars
            .filter((row) => row.key && row.enabled !== false)
            .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
    }

    function handleUpdateEnvVar(key: string, newValue: string) {
        if (!activeEnvId) return;
        setEnvironments((prev) => prev.map(env => {
            if (env.id !== activeEnvId) return env;
            const existing = env.vars.find(v => v.key === key);
            let updatedVars: EnvVar[];
            if (existing) {
                updatedVars = env.vars.map(v => v.key === key ? { ...v, value: newValue } : v);
            } else {
                updatedVars = [...env.vars, { key, value: newValue, comment: "", enabled: true }];
            }
            return { ...env, vars: updatedVars };
        }));
    }

    function interpolate(value: string | any): string | any {
        if (typeof value !== "string") return value;
        const vars = getEnvVars();
        return value.replace(/\{\{(.*?)\}\}/g, (_match, key) => {
            const trimmed = String(key).trim();
            return Object.prototype.hasOwnProperty.call(vars, trimmed) ? vars[trimmed] : "";
        });
    }

    function redactSecrets(value: string | any): string | any {
        if (typeof value !== "string") return value;
        const env = getActiveEnv();
        if (!env || !env.vars) return value;
        let redacted = value;
        env.vars.forEach(v => {
            if (v.secret && v.enabled && v.value) {
                // Replace any occurrence of the secret value with its placeholder
                const escapedValue = v.value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
                redacted = redacted.replace(new RegExp(escapedValue, 'g'), `{{${v.key}}}`);
            }
        });
        return redacted;
    }

    return {
        environments, setEnvironments,
        activeEnvId, setActiveEnvId,
        showEnvModal, setShowEnvModal,
        selectedEnvIds, setSelectedEnvIds,
        editingEnvKey, setEditingEnvKey,
        editingEnvDraft, setEditingEnvDraft,
        cmEnvEdit, setCmEnvEdit,
        getActiveEnv,
        getEnvVars,
        handleUpdateEnvVar,
        interpolate,
        redactSecrets
    };
}
