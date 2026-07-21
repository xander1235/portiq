import React from "react";
import {
  Globe,
  Share2,
  ArrowLeftRight,
  Zap,
  Rss,
  Plug,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

interface Protocol {
  id: string;
  label: string;
  color: string;
  desc: string;
  icon: LucideIcon;
}

const PROTOCOLS: Protocol[] = [
  {
    id: "http", label: "HTTP", color: "#22c55e",
    desc: "REST API requests with full method, header, body and auth support",
    icon: Globe,
  },
  {
    id: "graphql", label: "GraphQL", color: "#e535ab",
    desc: "Write queries & mutations with variables and introspection",
    icon: Share2,
  },
  {
    id: "websocket", label: "WebSocket", color: "#f59e0b",
    desc: "Persistent bi-directional real-time connections",
    icon: ArrowLeftRight,
  },
  {
    id: "grpc", label: "gRPC", color: "#00bcd4",
    desc: "Protocol-buffer based service calls with streaming",
    icon: Zap,
  },
  {
    id: "sse", label: "SSE / Socket", color: "#a78bfa",
    desc: "Server-Sent Events and raw socket streams",
    icon: Rss,
  },
  {
    id: "mcp", label: "MCP", color: "#f472b6",
    desc: "Model Context Protocol for AI tool & resource access",
    icon: Plug,
  },
  {
    id: "dag", label: "DAG Flow", color: "#fb923c",
    desc: "Chain multiple requests in a directed graph workflow",
    icon: Workflow,
  },
];

/**
 * A spacious modal for selecting a protocol when creating a new request
 * or changing the protocol of an existing one.
 */
interface ProtocolPickerProps {
  onSelect: (id: string) => void;
  onClose: () => void;
  currentProtocol: string;
}

export function ProtocolPicker({ onSelect, onClose, currentProtocol }: ProtocolPickerProps) {
  return (
    <div
      style={{
        width: "520px",
        maxWidth: "92vw",
        background: "var(--panel)",
        borderRadius: "14px",
        border: "1px solid var(--border)",
        boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
        overflow: "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        padding: "20px 24px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text)" }}>
            Choose Protocol
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Select the request type to get started
          </p>
        </div>
        <button
          className="ghost icon-button"
          onClick={onClose}
          style={{ padding: "4px 8px", color: "var(--text-muted)", display: "flex", alignItems: "center" }}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* Protocol grid */}
      <div style={{
        padding: "8px 20px 20px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "10px",
      }}>
        {PROTOCOLS.map((proto) => {
          const isActive = currentProtocol === proto.id;
          const Icon = proto.icon;
          return (
            <button
              key={proto.id}
              className="ghost"
              onClick={(e) => { e.stopPropagation(); onSelect(proto.id); }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "6px",
                padding: "14px 16px",
                borderRadius: "10px",
                border: isActive ? `1.5px solid ${proto.color}` : "1.5px solid var(--border)",
                background: isActive ? `${proto.color}12` : "transparent",
                cursor: "pointer",
                transition: "all 0.15s ease",
                textAlign: "left",
                minHeight: "80px",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.border = `1.5px solid ${proto.color}60`;
                  e.currentTarget.style.background = `${proto.color}08`;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.border = "1.5px solid var(--border)";
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                <span style={{
                  width: "28px", height: "28px", borderRadius: "8px",
                  background: `${proto.color}20`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <Icon size={16} color={proto.color} strokeWidth={2} aria-hidden="true" />
                </span>
                <span style={{
                  fontSize: "0.9rem", fontWeight: 700, color: proto.color,
                  letterSpacing: "0.01em",
                }}>
                  {proto.label}
                </span>
                {isActive && (
                  <span style={{
                    marginLeft: "auto", fontSize: "0.65rem", fontWeight: 600,
                    padding: "2px 6px", borderRadius: "4px",
                    background: `${proto.color}20`, color: proto.color,
                  }}>
                    current
                  </span>
                )}
              </div>
              <span style={{
                fontSize: "0.72rem", color: "var(--text-muted)",
                lineHeight: 1.4, paddingLeft: "36px",
              }}>
                {proto.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { PROTOCOLS };
