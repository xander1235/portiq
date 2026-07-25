import type { ScriptStep } from "./script";
import type { DagGraph } from "../flows/types";

export interface RequestRow {
  key: string;
  value: string;
  comment: string;
  enabled: boolean;
  kind?: "text" | "file";
  fileName?: string;
  mimeType?: string;
  fileBase64?: string;
}

export interface AuthConfig {
  bearer: { token: string };
  basic: { username: string; password: string };
  api_key: { key: string; value: string; add_to: "header" | "query" };
}

export interface GraphqlConfig {
  query: string;
  variables: string;
  operationName: string;
  headers: Record<string, string>;
}

export interface GrpcConfig {
  service: string;
  method: string;
  requestBody?: string;
  metadata?: Record<string, string>;
  callType?: "UNARY" | "SERVER_STREAM" | "CLIENT_STREAM" | "BIDI_STREAM";
  deadline?: number;
  tls?: boolean;
  protoContent?: string;
  protoPath?: string;
  messages?: string[];
  useReflection?: boolean;
  tlsConfig?: { rootCertsPem?: string; clientCertPem?: string; clientKeyPem?: string };
  callToken?: string;
}

export interface WsMessage {
  type: "sent" | "received";
  text: string;
  timestamp: number;
}

export interface WsConfig {
  headersText: string;
  headersRows: RequestRow[];
  headersMode: "table" | "raw";
  protocolsText: string;
  protocolRows: RequestRow[];
  autoReconnect: boolean;
  reconnectInterval: number;
  connectTimeout: number;
  messageType: "text" | "json";
  messages: WsMessage[];
}

export interface RequestItem {
  type: "request";
  id: string;
  name: string;
  description: string;
  tags: string[];
  protocol: string;
  method: string;
  url: string;
  headersText?: string;
  bodyText?: string;
  testsPreText?: string;   // deprecated: migrated to testsPreSteps
  testsPostText?: string;  // deprecated: migrated to testsPostSteps
  testsPreSteps?: ScriptStep[];
  testsPostSteps?: ScriptStep[];
  vizScriptText?: string;
  testsInputText?: string;
  httpVersion?: string;
  requestTimeoutMs?: number;
  bodyType?: string;
  paramsRows?: RequestRow[];
  headersRows?: RequestRow[];
  authRows?: RequestRow[];
  authType?: string;
  authConfig?: AuthConfig;
  bodyRows?: RequestRow[];
  graphqlConfig?: GraphqlConfig;
  grpcConfig?: GrpcConfig;
  wsConfig?: WsConfig;
  dagGraph?: DagGraph;
  paneLayout?: { topHeight?: number; rightWidth?: number };
}

export interface FolderItem {
  type: "folder";
  id: string;
  name: string;
  items: (FolderItem | RequestItem)[];
}

export interface Collection {
  id: string;
  name: string;
  items: (FolderItem | RequestItem)[];
  variables?: Record<string, string>;
}
