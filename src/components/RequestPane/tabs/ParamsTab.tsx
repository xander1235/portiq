import { TableEditor } from "../../TableEditor";

interface ParamsTabProps {
    paramsRows: any[];
    setParamsRows: (rows: any[]) => void;
    currentRequestId: string;
    updateRequestState: (id: string, key: string, val: any) => void;
    getEnvVars: () => any;
    handleUpdateEnvVar: (key: string, val: string) => void;
}

export function ParamsTab({
    paramsRows,
    setParamsRows,
    currentRequestId,
    updateRequestState,
    getEnvVars,
    handleUpdateEnvVar
}: ParamsTabProps) {
    return (
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
    );
}
