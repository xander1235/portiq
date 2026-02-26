import { useState } from "react";
import { useLocalStorage } from "./useLocalStorage.js";

export function useEnvironmentState() {
    const [environments, setEnvironments] = useLocalStorage("ui_environments", [
        {
            id: "env-default",
            name: "Local",
            vars: [{ key: "baseUrl", value: "https://api.example.com", comment: "", enabled: true }]
        }
    ]);
    const [activeEnvId, setActiveEnvId] = useLocalStorage("ui_activeEnvId", "env-default");

    const [showEnvModal, setShowEnvModal] = useState(false);
    const [selectedEnvIds, setSelectedEnvIds] = useState([]);
    const [editingEnvKey, setEditingEnvKey] = useState(null);
    const [editingEnvDraft, setEditingEnvDraft] = useState("");
    const [cmEnvEdit, setCmEnvEdit] = useState(null);

    function getActiveEnv() {
        if (!Array.isArray(environments) || environments.length === 0) return null;
        return environments.find((env) => env.id === activeEnvId) || environments[0];
    }

    function getEnvVars() {
        const env = getActiveEnv();
        if (!env) return {};
        return env.vars
            .filter((row) => row.key && row.enabled !== false)
            .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
    }

    function handleUpdateEnvVar(key, newValue) {
        if (!activeEnvId) return;
        setEnvironments((prev) => prev.map(env => {
            if (env.id !== activeEnvId) return env;
            const existing = env.vars.find(v => v.key === key);
            let updatedVars;
            if (existing) {
                updatedVars = env.vars.map(v => v.key === key ? { ...v, value: newValue } : v);
            } else {
                updatedVars = [...env.vars, { key, value: newValue, comment: "", enabled: true }];
            }
            return { ...env, vars: updatedVars };
        }));
    }

    function interpolate(value) {
        if (typeof value !== "string") return value;
        const vars = getEnvVars();
        return value.replace(/\{\{(.*?)\}\}/g, (_match, key) => {
            const trimmed = String(key).trim();
            return Object.prototype.hasOwnProperty.call(vars, trimmed) ? vars[trimmed] : "";
        });
    }

    function redactSecrets(value) {
        if (typeof value !== "string") return value;
        const env = getActiveEnv();
        if (!env || !env.vars) return value;
        let redacted = value;
        env.vars.forEach(v => {
            if (v.secret && v.enabled && v.value) {
                // Replace any occurrence of the secret value with its placeholder
                const escapedValue = v.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
