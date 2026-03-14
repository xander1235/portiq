/**
 * Robust fetch wrapper that routes through Electron IPC for production (DMG) builds,
 * bypassing the need for Vite dev-server proxies and avoiding CORS.
 */
export async function safeFetch(path, options = {}) {
  const urlMap = {
    '/github-oauth': 'https://github.com',
    '/proxy-openai': 'https://api.openai.com',
    '/proxy-anthropic': 'https://api.anthropic.com',
    '/proxy-gemini': 'https://generativelanguage.googleapis.com'
  };

  let finalUrl = path;
  for (const [proxyRoot, realRoot] of Object.entries(urlMap)) {
    if (path.startsWith(proxyRoot)) {
      finalUrl = path.replace(proxyRoot, realRoot);
      break;
    }
  }

  // If window.api.sendRequest exists (Electron context), use it to bypass CORS and network limitations
  if (window.api && window.api.sendRequest) {
    const payload = {
      url: finalUrl,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body
    };
    const response = await window.api.sendRequest(payload);
    if (response.error) throw new Error(response.error);
    
    // Polyfill the response interface the app expects
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.json,
      text: async () => response.body,
      headers: {
        get: (name) => response.headers[name.toLowerCase()] || null
      }
    };
  }

  // Fallback to standard fetch (Development)
  return fetch(path, options);
}
