import { SECRET_PLACEHOLDER_PREFIX, LEGACY_SECRET_PLACEHOLDER_PREFIX } from "./constants";

export function makeSecretPlaceholder(scope: string): string {
  return `${SECRET_PLACEHOLDER_PREFIX}${scope}`;
}

export function isSecretPlaceholder(value: any): boolean {
  return typeof value === "string" &&
    (value.startsWith(SECRET_PLACEHOLDER_PREFIX) || value.startsWith(LEGACY_SECRET_PLACEHOLDER_PREFIX));
}

export function parseSecretPlaceholder(value: string): string | null {
  if (!isSecretPlaceholder(value)) return null;
  if (value.startsWith(SECRET_PLACEHOLDER_PREFIX)) return value.slice(SECRET_PLACEHOLDER_PREFIX.length);
  if (value.startsWith(LEGACY_SECRET_PLACEHOLDER_PREFIX)) return value.slice(LEGACY_SECRET_PLACEHOLDER_PREFIX.length);
  return null;
}

export function isSensitiveKey(key: any): boolean {
  return /authorization|api[-_ ]?key|token|secret|password|cookie|auth|credential/i.test(String(key || ""));
}

export function sanitizeSensitiveMap(input: any, scope: string): any {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const next = { ...input };
  Object.keys(next).forEach((key) => {
    if (next[key] && isSensitiveKey(key)) {
      next[key] = makeSecretPlaceholder(`${scope}:${key}`);
    }
  });
  return next;
}

export function sanitizeSensitiveRows(rows: any[], scope: string): any[] {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row, index) => {
    if (!row || typeof row !== "object") return row;
    if (!row.value || !isSensitiveKey(row.key)) return row;
    return {
      ...row,
      value: makeSecretPlaceholder(`${scope}:row:${index}:${row.key || "value"}`),
    };
  });
}

export function sanitizeSensitiveJsonText(text: string, scope: string): string {
  if (typeof text !== "string" || !text.trim()) return text;
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(sanitizeSensitiveMap(parsed, scope), null, 2);
  } catch {
    return text;
  }
}

export function sanitizeAuthConfig(authConfig: any, scope: string): any {
  const base = authConfig && typeof authConfig === "object" ? authConfig : {};
  const next = {
    bearer: { ...(base.bearer || {}) },
    basic: { ...(base.basic || {}) },
    api_key: { ...(base.api_key || {}) },
  };
  if (next.bearer.token) next.bearer.token = makeSecretPlaceholder(`${scope}:auth:bearer:token`);
  if (next.basic.password) next.basic.password = makeSecretPlaceholder(`${scope}:auth:basic:password`);
  if (next.api_key.value) next.api_key.value = makeSecretPlaceholder(`${scope}:auth:api_key:value`);
  return next;
}

export function sanitizeWsConfig(wsConfig: any, scope: string): any {
  if (!wsConfig || typeof wsConfig !== "object") return wsConfig;
  return {
    ...wsConfig,
    headersRows: sanitizeSensitiveRows(wsConfig.headersRows, `${scope}:ws:headersRows`),
    headersText: sanitizeSensitiveJsonText(wsConfig.headersText, `${scope}:ws:headersText`),
  };
}

export function sanitizeGraphqlConfig(graphqlConfig: any, scope: string): any {
  if (!graphqlConfig || typeof graphqlConfig !== "object") return graphqlConfig;
  return {
    ...graphqlConfig,
    headers: sanitizeSensitiveMap(graphqlConfig.headers, `${scope}:graphql:headers`),
  };
}

export function sanitizeRequestSecrets(request: any, scope: string): any {
  if (!request || typeof request !== "object") return request;
  return {
    ...request,
    authConfig: sanitizeAuthConfig(request.authConfig, scope),
    authRows: sanitizeSensitiveRows(request.authRows, `${scope}:authRows`),
    headersRows: sanitizeSensitiveRows(request.headersRows, `${scope}:headersRows`),
    paramsRows: sanitizeSensitiveRows(request.paramsRows, `${scope}:paramsRows`),
    headersText: sanitizeSensitiveJsonText(request.headersText, `${scope}:headersText`),
    graphqlConfig: sanitizeGraphqlConfig(request.graphqlConfig, scope),
    wsConfig: sanitizeWsConfig(request.wsConfig, scope),
  };
}

export function restoreRowsWithLocalSecrets(remoteRows: any[], localRows: any[]): any[] {
  if (!Array.isArray(remoteRows)) return remoteRows;
  const localList = Array.isArray(localRows) ? localRows : [];
  return remoteRows.map((row, index) => {
    if (!row || typeof row !== "object" || !isSecretPlaceholder(row.value)) return row;
    const localRow = localList[index];
    if (localRow?.value && !isSecretPlaceholder(localRow.value)) {
      return { ...row, value: localRow.value };
    }
    return row;
  });
}

export function restoreMapWithLocalSecrets(remoteMap: any, localMap: any): any {
  if (!remoteMap || typeof remoteMap !== "object" || Array.isArray(remoteMap)) return remoteMap;
  const local = localMap && typeof localMap === "object" ? localMap : {};
  const next = { ...remoteMap };
  Object.keys(next).forEach((key) => {
    if (isSecretPlaceholder(next[key]) && local[key] && !isSecretPlaceholder(local[key])) {
      next[key] = local[key];
    }
  });
  return next;
}

export function restoreJsonTextWithLocalSecrets(remoteText: string, localText: string): string {
  if (typeof remoteText !== "string" || !remoteText.trim()) return remoteText;
  try {
    const remote = JSON.parse(remoteText);
    const local = typeof localText === "string" && localText.trim() ? JSON.parse(localText) : {};
    return JSON.stringify(restoreMapWithLocalSecrets(remote, local), null, 2);
  } catch {
    return remoteText;
  }
}

export function restoreAuthConfigWithLocalSecrets(remoteAuthConfig: any, localAuthConfig: any): any {
  const remote = remoteAuthConfig && typeof remoteAuthConfig === "object" ? remoteAuthConfig : {};
  const local = localAuthConfig && typeof localAuthConfig === "object" ? localAuthConfig : {};
  const next = {
    bearer: { ...(remote.bearer || {}) },
    basic: { ...(remote.basic || {}) },
    api_key: { ...(remote.api_key || {}) },
  };
  if (isSecretPlaceholder(next.bearer.token) && local?.bearer?.token) next.bearer.token = local.bearer.token;
  if (isSecretPlaceholder(next.basic.password) && local?.basic?.password) next.basic.password = local.basic.password;
  if (isSecretPlaceholder(next.api_key.value) && local?.api_key?.value) next.api_key.value = local.api_key.value;
  return next;
}

export function restoreRequestSecrets(remoteRequest: any, localRequest: any): any {
  if (!remoteRequest || typeof remoteRequest !== "object") return remoteRequest;
  const local = localRequest && typeof localRequest === "object" ? localRequest : {};
  return {
    ...remoteRequest,
    authConfig: restoreAuthConfigWithLocalSecrets(remoteRequest.authConfig, local.authConfig),
    authRows: restoreRowsWithLocalSecrets(remoteRequest.authRows, local.authRows),
    headersRows: restoreRowsWithLocalSecrets(remoteRequest.headersRows, local.headersRows),
    paramsRows: restoreRowsWithLocalSecrets(remoteRequest.paramsRows, local.paramsRows),
    headersText: restoreJsonTextWithLocalSecrets(remoteRequest.headersText, local.headersText),
    graphqlConfig: remoteRequest.graphqlConfig
      ? {
          ...remoteRequest.graphqlConfig,
          headers: restoreMapWithLocalSecrets(remoteRequest.graphqlConfig.headers, local?.graphqlConfig?.headers),
        }
      : remoteRequest.graphqlConfig,
    wsConfig: remoteRequest.wsConfig
      ? {
          ...remoteRequest.wsConfig,
          headersRows: restoreRowsWithLocalSecrets(remoteRequest.wsConfig.headersRows, local?.wsConfig?.headersRows),
          headersText: restoreJsonTextWithLocalSecrets(remoteRequest.wsConfig.headersText, local?.wsConfig?.headersText),
        }
      : remoteRequest.wsConfig,
  };
}
