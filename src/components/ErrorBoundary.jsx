import React from "react";

/**
 * ErrorBoundary catches JavaScript errors in child components and
 * renders a fallback UI instead of crashing the whole app.
 *
 * Usage:
 *   <ErrorBoundary fallback={<div>Something went wrong</div>}>
 *     <App />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log error for diagnostics
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px",
          gap: "16px",
          background: "var(--bg, #1a1a2e)",
          borderRadius: "12px",
          border: "1px solid var(--border, #333)",
          margin: "20px",
          minHeight: "200px"
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ margin: 0, color: "var(--text, #fff)", fontSize: "1.1rem", fontWeight: 600 }}>
            Something went wrong
          </h2>
          <p style={{ margin: 0, color: "var(--text-muted, #888)", fontSize: "0.85rem", maxWidth: "400px", textAlign: "center" }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          {this.state.errorInfo && (
            <details style={{ maxWidth: "500px", width: "100%" }}>
              <summary style={{
                cursor: "pointer",
                color: "var(--text-muted, #888)",
                fontSize: "0.8rem",
                marginBottom: "8px"
              }}>
                Error details
              </summary>
              <pre style={{
                background: "var(--panel, #1e1e3f)",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "0.75rem",
                color: "var(--text-muted, #888)",
                overflow: "auto",
                maxHeight: "200px",
                whiteSpace: "pre-wrap",
                border: "1px solid var(--border, #333)"
              }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={this.handleReset}
            style={{
              padding: "8px 20px",
              borderRadius: "8px",
              border: "1px solid var(--border, #333)",
              background: "var(--accent, #6366f1)",
              color: "#fff",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 600,
              transition: "opacity 0.2s"
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = "0.85"}
            onMouseOut={(e) => e.currentTarget.style.opacity = "1"}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
