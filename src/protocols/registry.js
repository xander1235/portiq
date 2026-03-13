/**
 * Protocol Registry
 *
 * An extensible system for registering and managing different API protocols.
 * Each protocol implements a standard interface allowing the app to seamlessly
 * support HTTP, GraphQL, WebSocket, gRPC, and any future protocols.
 *
 * To add a new protocol:
 *   1. Create a protocol handler implementing the ProtocolHandler interface
 *   2. Register it: ProtocolRegistry.register(myProtocol)
 *   3. Create a UI pane component for the request/response
 *
 * ProtocolHandler interface:
 *   {
 *     id: string,              // Unique identifier (e.g., "http", "graphql")
 *     name: string,            // Display name
 *     description: string,     // Short description
 *     icon: string,            // SVG icon markup
 *     color: string,           // Accent color for the protocol badge
 *     methods: string[],       // Available operations/methods
 *     defaultConfig: object,   // Default request configuration
 *     validateRequest: (config) => { valid: boolean, errors: string[] },
 *     buildRequest: (config) => payload,  // Build IPC-ready payload
 *     parseResponse: (raw) => response,   // Parse raw response
 *     getDefaultUrl: () => string,        // Default URL hint
 *     detectProtocol: (url) => boolean,   // Auto-detect from URL
 *   }
 */

class ProtocolRegistryClass {
  constructor() {
    this._protocols = new Map();
    this._listeners = new Set();
  }

  /**
   * Register a protocol handler.
   * @param {object} protocol - Protocol handler implementing the interface
   */
  register(protocol) {
    if (!protocol.id || !protocol.name) {
      throw new Error("Protocol must have an 'id' and 'name'");
    }
    if (this._protocols.has(protocol.id)) {
      console.warn(`Protocol "${protocol.id}" is already registered. Overwriting.`);
    }
    this._protocols.set(protocol.id, protocol);
    this._notifyListeners();
  }

  /**
   * Unregister a protocol handler.
   * @param {string} protocolId
   */
  unregister(protocolId) {
    this._protocols.delete(protocolId);
    this._notifyListeners();
  }

  /**
   * Get a specific protocol handler.
   * @param {string} protocolId
   * @returns {object|null}
   */
  get(protocolId) {
    return this._protocols.get(protocolId) || null;
  }

  /**
   * Get all registered protocols.
   * @returns {object[]}
   */
  getAll() {
    return Array.from(this._protocols.values());
  }

  /**
   * Get all protocol IDs.
   * @returns {string[]}
   */
  getIds() {
    return Array.from(this._protocols.keys());
  }

  /**
   * Auto-detect the protocol from a URL.
   * @param {string} url
   * @returns {object|null}
   */
  detectFromUrl(url) {
    for (const protocol of this._protocols.values()) {
      if (protocol.detectProtocol && protocol.detectProtocol(url)) {
        return protocol;
      }
    }
    // Default to HTTP
    return this._protocols.get("http") || null;
  }

  /**
   * Subscribe to registry changes.
   * @param {function} listener
   * @returns {function} unsubscribe
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notifyListeners() {
    this._listeners.forEach(fn => fn(this.getAll()));
  }
}

export const ProtocolRegistry = new ProtocolRegistryClass();

export default ProtocolRegistry;
