/**
 * gRPC Protocol Handler
 *
 * Provides gRPC support using gRPC-Web as the transport layer.
 * Supports unary calls, server streaming, and proto file loading.
 *
 * Note: Full native gRPC requires additional native dependencies.
 * This implementation uses gRPC-Web which works via HTTP/2 proxy
 * (e.g., Envoy) or gRPC-Web compatible servers.
 *
 * For full native gRPC support, install @grpc/grpc-js and
 * @grpc/proto-loader, then register the NativeGrpcProtocol.
 */

import { ProtocolHandler } from "./registry";

export interface GrpcService {
  name: string;
  methods: {
    name: string;
    inputType: string;
    outputType: string;
    callType: string;
  }[];
}

export interface GrpcMessage {
  name: string;
  fields: {
    type: string;
    name: string;
    number: number;
  }[];
}

export const GrpcProtocol: ProtocolHandler & {
  parseProtoSchema: (protoContent: string) => { services: GrpcService[]; messages: GrpcMessage[] };
  generateSampleBody: (messageName: string, messages: GrpcMessage[]) => string;
  statusCodes: Record<number, { name: string; description: string }>;
  getStatusName: (code: number) => string;
} = {
  id: "grpc",
  name: "gRPC",
  description: "gRPC/gRPC-Web remote procedure calls",
  color: "#00bcd4",
  icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`,

  methods: ["UNARY", "SERVER_STREAM", "CLIENT_STREAM", "BIDI_STREAM"],

  defaultConfig: {
    url: "",
    service: "",
    method: "",
    protoContent: "",
    requestBody: "{}",
    metadata: {},      // gRPC metadata (equivalent to HTTP headers)
    callType: "UNARY", // UNARY | SERVER_STREAM | CLIENT_STREAM | BIDI_STREAM
    deadline: 30000,   // timeout in ms
    tls: true
  },

  getDefaultUrl() {
    return "localhost:50051";
  },

  detectProtocol(url: string) {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    return lower.startsWith("grpc://") || lower.startsWith("grpcs://");
  },

  validateRequest(config: any) {
    const errors: string[] = [];
    if (!config.url || !config.url.trim()) {
      errors.push("gRPC server address is required");
    }
    if (!config.service || !config.service.trim()) {
      errors.push("Service name is required");
    }
    if (!config.method || !config.method.trim()) {
      errors.push("Method name is required");
    }
    if (config.requestBody) {
      try {
        if (typeof config.requestBody === "string" && config.requestBody.trim()) {
          JSON.parse(config.requestBody);
        }
      } catch (e) {
        errors.push("Request body must be valid JSON");
      }
    }
    if (config.deadline && (typeof config.deadline !== "number" || config.deadline < 0)) {
      errors.push("Deadline must be a positive number (ms)");
    }
    return { valid: errors.length === 0, errors };
  },

  buildRequest(config: any) {
    let body = {};
    if (config.requestBody) {
      try {
        body = typeof config.requestBody === "string"
          ? JSON.parse(config.requestBody)
          : config.requestBody;
      } catch (e) {
        body = {};
      }
    }

    return {
      url: config.url,
      service: config.service,
      method: config.method,
      body,
      metadata: config.metadata || {},
      callType: config.callType || "UNARY",
      deadline: config.deadline || 30000,
      tls: config.tls !== false
    };
  },

  parseResponse(raw: any) {
    return {
      status: raw.status || null,
      statusCode: raw.statusCode || 0,
      statusMessage: raw.statusMessage || "",
      duration: raw.duration || 0,
      metadata: raw.metadata || {},
      trailers: raw.trailers || {},
      body: raw.body || "",
      json: raw.json || null,
      error: raw.error || null,
      messages: raw.messages || [],  // For streaming responses
      size: raw.body ? new Blob([raw.body]).size : 0
    };
  },

  /**
   * Parse a proto file content and extract services/methods.
   * Returns a simplified schema for the UI.
   */
  parseProtoSchema(protoContent: string) {
    if (!protoContent) return { services: [], messages: [] };

    const services: GrpcService[] = [];
    const messages: GrpcMessage[] = [];

    // Simple regex-based parser for proto3 files
    // For production, use a proper protobuf parser
    const serviceRegex = /service\s+(\w+)\s*\{([^}]*)\}/gs;
    const messageRegex = /message\s+(\w+)\s*\{([^}]*)\}/gs;

    let serviceMatch;
    while ((serviceMatch = serviceRegex.exec(protoContent)) !== null) {
      const service: GrpcService = { name: serviceMatch[1], methods: [] };
      const body = serviceMatch[2];

      let methodMatch;
      const localMethodRegex = /rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\)/g;
      while ((methodMatch = localMethodRegex.exec(body)) !== null) {
        const isClientStream = !!methodMatch[2];
        const isServerStream = !!methodMatch[4];
        let callType = "UNARY";
        if (isClientStream && isServerStream) callType = "BIDI_STREAM";
        else if (isClientStream) callType = "CLIENT_STREAM";
        else if (isServerStream) callType = "SERVER_STREAM";

        service.methods.push({
          name: methodMatch[1],
          inputType: methodMatch[3],
          outputType: methodMatch[5],
          callType
        });
      }
      services.push(service);
    }

    let messageMatch;
    while ((messageMatch = messageRegex.exec(protoContent)) !== null) {
      const msg: GrpcMessage = { name: messageMatch[1], fields: [] };
      const body = messageMatch[2];

      let fieldMatch;
      const localFieldRegex = /(?:repeated\s+|optional\s+|required\s+)?(\w+)\s+(\w+)\s*=\s*(\d+)/g;
      while ((fieldMatch = localFieldRegex.exec(body)) !== null) {
        msg.fields.push({
          type: fieldMatch[1],
          name: fieldMatch[2],
          number: parseInt(fieldMatch[3])
        });
      }
      messages.push(msg);
    }

    return { services, messages };
  },

  /**
   * Generate a sample request body JSON from a message definition.
   */
  generateSampleBody(messageName: string, messages: GrpcMessage[]) {
    const msg = messages.find(m => m.name === messageName);
    if (!msg) return "{}";

    const body: Record<string, any> = {};
    const typeDefaults: Record<string, string> = {
      string: '""',
      int32: "0", int64: "0", uint32: "0", uint64: "0",
      sint32: "0", sint64: "0",
      fixed32: "0", fixed64: "0",
      sfixed32: "0", sfixed64: "0",
      float: "0.0", double: "0.0",
      bool: "false",
      bytes: '""'
    };

    msg.fields.forEach(field => {
      if (typeDefaults[field.type] !== undefined) {
        body[field.name] = JSON.parse(typeDefaults[field.type]);
      } else {
        // Nested message type
        body[field.name] = {};
      }
    });

    return JSON.stringify(body, null, 2);
  },

  /**
   * gRPC status codes mapping.
   */
  statusCodes: {
    0: { name: "OK", description: "Success" },
    1: { name: "CANCELLED", description: "The operation was cancelled" },
    2: { name: "UNKNOWN", description: "Unknown error" },
    3: { name: "INVALID_ARGUMENT", description: "Invalid argument" },
    4: { name: "DEADLINE_EXCEEDED", description: "Deadline exceeded" },
    5: { name: "NOT_FOUND", description: "Not found" },
    6: { name: "ALREADY_EXISTS", description: "Already exists" },
    7: { name: "PERMISSION_DENIED", description: "Permission denied" },
    8: { name: "RESOURCE_EXHAUSTED", description: "Resource exhausted" },
    9: { name: "FAILED_PRECONDITION", description: "Failed precondition" },
    10: { name: "ABORTED", description: "Aborted" },
    11: { name: "OUT_OF_RANGE", description: "Out of range" },
    12: { name: "UNIMPLEMENTED", description: "Unimplemented" },
    13: { name: "INTERNAL", description: "Internal error" },
    14: { name: "UNAVAILABLE", description: "Service unavailable" },
    15: { name: "DATA_LOSS", description: "Data loss" },
    16: { name: "UNAUTHENTICATED", description: "Not authenticated" }
  },

  getStatusName(code: number) {
    return GrpcProtocol.statusCodes[code]?.name || `UNKNOWN (${code})`;
  }
};

export default GrpcProtocol;
