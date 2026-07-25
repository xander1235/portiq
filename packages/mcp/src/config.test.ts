import { describe, it, expect } from "vitest";
import { parseServerConfig } from "./config";

describe("parseServerConfig", () => {
  it("defaults to writes disabled and no explicit dataDir", () => {
    const c = parseServerConfig([], {});
    expect(c.allowWrites).toBe(false);
    expect(c.dataDir).toBeUndefined();
    expect(c.appVersion).toBe("0.1.0");
  });

  it("enables writes via --allow-writes flag", () => {
    expect(parseServerConfig(["--allow-writes"], {}).allowWrites).toBe(true);
  });

  it("enables writes via PORTIQ_MCP_ALLOW_WRITES=1", () => {
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "1" }).allowWrites).toBe(true);
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "true" }).allowWrites).toBe(true);
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "0" }).allowWrites).toBe(false);
  });

  it("reads --data-dir in both spaced and = forms", () => {
    expect(parseServerConfig(["--data-dir", "/tmp/a"], {}).dataDir).toBe("/tmp/a");
    expect(parseServerConfig(["--data-dir=/tmp/b"], {}).dataDir).toBe("/tmp/b");
  });

  it("honors PORTIQ_MCP_APP_VERSION override", () => {
    expect(parseServerConfig([], { PORTIQ_MCP_APP_VERSION: "9.9.9" }).appVersion).toBe("9.9.9");
  });
});

describe("parseServerConfig — HTTP transport", () => {
  it("defaults to stdio transport", () => {
    expect(parseServerConfig([], {}).transport).toBe("stdio");
  });

  it("selects http via --http and reads host/port/auth-token", () => {
    const c = parseServerConfig(["--http", "--host", "0.0.0.0", "--port", "8080", "--auth-token", "t0k"], {});
    expect(c.transport).toBe("http");
    expect(c.httpHost).toBe("0.0.0.0");
    expect(c.httpPort).toBe(8080);
    expect(c.authToken).toBe("t0k");
  });

  it("selects http via PORTIQ_MCP_HTTP and reads env host/port", () => {
    const c = parseServerConfig([], { PORTIQ_MCP_HTTP: "1", PORTIQ_MCP_HOST: "localhost", PORTIQ_MCP_PORT: "9000" });
    expect(c.transport).toBe("http");
    expect(c.httpHost).toBe("localhost");
    expect(c.httpPort).toBe(9000);
  });

  it("defaults http host/port when unspecified", () => {
    const c = parseServerConfig(["--http"], {});
    expect(c.httpHost).toBe("127.0.0.1");
    expect(c.httpPort).toBe(3939);
  });

  it("honors = forms and lets --stdio override --http", () => {
    const c = parseServerConfig(["--http", "--port=7000", "--stdio"], {});
    expect(c.transport).toBe("stdio");
    expect(c.httpPort).toBe(7000);
  });
});

describe("parseServerConfig — exec allow/deny", () => {
  it("defaults to empty lists", () => {
    const c = parseServerConfig([], {});
    expect(c.execAllow).toEqual([]);
    expect(c.execDeny).toEqual([]);
  });

  it("accumulates repeated and comma-separated flags", () => {
    const c = parseServerConfig(["--exec-allow", "a.com,b.com", "--exec-deny=c.com", "--exec-deny", "d.com"], {});
    expect(c.execAllow).toEqual(["a.com", "b.com"]);
    expect(c.execDeny).toEqual(["c.com", "d.com"]);
  });

  it("merges env lists before flag lists", () => {
    const c = parseServerConfig(["--exec-deny", "flag.com"], { PORTIQ_MCP_EXEC_DENY: "env1.com, env2.com" });
    expect(c.execDeny).toEqual(["env1.com", "env2.com", "flag.com"]);
  });
});
