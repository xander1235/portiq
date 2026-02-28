/**
 * Mock Server Service
 *
 * Client-side service for managing mock servers through the Electron IPC bridge.
 * Provides a clean API for creating, managing, and configuring mock API servers.
 *
 * Usage:
 *   import { MockServerService } from './services/mockServer';
 *   const server = await MockServerService.start({ port: 3001, routes: [...] });
 *   await MockServerService.stop(server.id);
 */

let serverIdCounter = 0;

function generateServerId() {
  return `mock-${Date.now()}-${++serverIdCounter}`;
}

export const MockServerService = {
  /**
   * Start a new mock server.
   * @param {object} config
   * @param {number} config.port - Port number (1-65535)
   * @param {string} config.name - Server display name
   * @param {Array} config.routes - Array of route definitions
   * @returns {Promise<{ok: boolean, id: string, port: number} | {error: string}>}
   */
  async start({ port, name, routes }) {
    const id = generateServerId();
    const sanitizedRoutes = (routes || []).map(r => ({
      method: r.method || "GET",
      path: r.path || "/",
      statusCode: r.statusCode || 200,
      headers: r.headers || { "Content-Type": "application/json" },
      body: r.body || {},
      delay: r.delay || 0,
      description: r.description || ""
    }));

    if (window.api?.mockStart) {
      const result = await window.api.mockStart({ id, port, routes: sanitizedRoutes });
      if (result.ok) {
        return { ok: true, id, port: result.port, name: name || `Mock Server :${port}` };
      }
      return result;
    }

    return { error: "Mock server API not available (requires Electron)" };
  },

  /**
   * Stop a running mock server.
   * @param {string} id - Server ID
   */
  async stop(id) {
    if (window.api?.mockStop) {
      return window.api.mockStop({ id });
    }
    return { error: "Mock server API not available" };
  },

  /**
   * List all running mock servers.
   */
  async list() {
    if (window.api?.mockList) {
      return window.api.mockList();
    }
    return [];
  },

  /**
   * Update routes on a running server.
   * @param {string} id - Server ID
   * @param {Array} routes - New route definitions
   */
  async updateRoutes(id, routes) {
    if (window.api?.mockUpdateRoutes) {
      return window.api.mockUpdateRoutes({ id, routes });
    }
    return { error: "Mock server API not available" };
  },

  /**
   * Create a default route template.
   */
  createDefaultRoute() {
    return {
      id: `route-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      method: "GET",
      path: "/api/example",
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello from mock server!" }, null, 2),
      delay: 0,
      description: "Example route"
    };
  },

  /**
   * Generate mock routes from a collection's requests.
   * Useful for quickly creating a mock server that mirrors real API structure.
   */
  generateRoutesFromCollection(collection) {
    if (!collection?.items) return [];

    const routes = [];
    const processItems = (items) => {
      for (const item of items) {
        if (item.type === "folder" && item.items) {
          processItems(item.items);
        } else if (item.type === "request") {
          try {
            let path = "/mock";
            if (item.url) {
              const urlObj = new URL(item.url.startsWith("http") ? item.url : `http://localhost${item.url}`);
              path = urlObj.pathname || "/mock";
            }

            routes.push({
              id: `route-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              method: item.method || "GET",
              path,
              statusCode: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                message: `Mock response for ${item.name}`,
                _mockSource: item.name,
                data: {}
              }, null, 2),
              delay: 0,
              description: `Mock for: ${item.name}`
            });
          } catch (e) {
            // Skip invalid URLs
          }
        }
      }
    };

    processItems(collection.items);
    return routes;
  }
};

export default MockServerService;
