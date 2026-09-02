import { useState } from "react";
import { useLocalStorage } from "./useLocalStorage";
import {
    getEnvVars as coreGetEnvVars,
    getSecretVars,
    interpolate as coreInterpolate,
    redactSecrets as coreRedactSecrets,
} from "@portiq/core";

export type { EnvVar, Environment } from "@portiq/core";
import type { EnvVar, Environment } from "@portiq/core";

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
        return coreGetEnvVars(getActiveEnv());
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
        return coreInterpolate(value, getEnvVars());
    }

    function redactSecrets(value: string | any): string | any {
        return coreRedactSecrets(value, getSecretVars(getActiveEnv()));
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
