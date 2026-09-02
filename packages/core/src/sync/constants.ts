export const SYNC_REPO_NAME = "portiq-sync";
export const WORKSPACE_ROOT = "workspace";
export const LEGACY_STATE_FILE = "state.json";

export const SECRET_PLACEHOLDER_PREFIX = "__PORTIQ_SECRET__:";
export const LEGACY_SECRET_PLACEHOLDER_PREFIX = "__COMMU_SECRET__:";

export const WORKSPACE_MANAGED_PREFIXES = [
  `${WORKSPACE_ROOT}/manifest.json`,
  `${WORKSPACE_ROOT}/settings.json`,
  `${WORKSPACE_ROOT}/draft/`,
  `${WORKSPACE_ROOT}/environments/`,
  `${WORKSPACE_ROOT}/collections/`,
];

export const HISTORY_PREFIX = `${WORKSPACE_ROOT}/history/`;
