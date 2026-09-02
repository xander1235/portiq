import { describe, it, expect } from "vitest";
import { encodeContent, decodeContent, slugify, buildWorkspaceFiles, previewMaskableVars, buildHistoryFiles } from "./serialize";
import type { AppState } from "../model";

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "My API",
    items: [
      { type: "request", id: "r1", name: "Get User", description: "", tags: [], protocol: "http", method: "GET", url: "https://x",
        authConfig: { bearer: { token: "SECRET" }, basic: {}, api_key: {} } } as any,
      { type: "folder", id: "f1", name: "Sub", items: [
        { type: "request", id: "r2", name: "Post", description: "", tags: [], protocol: "http", method: "POST", url: "https://y" } as any,
      ] } as any,
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "token", value: "abc", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("encode/decode/slug", () => {
  it("round-trips arbitrary JSON through base64", () => {
    const v = { a: 1, b: "héllo" };
    expect(decodeContent(encodeContent(v))).toEqual(v);
  });
  it("slugifies to lowercase dash form", () => {
    expect(slugify("My API!")).toBe("my-api");
    expect(slugify("")).toBe("item");
  });
});

describe("buildWorkspaceFiles", () => {
  it("emits manifest, settings, draft, environments and per-collection files", () => {
    const files = buildWorkspaceFiles(sample());
    expect(files["workspace/manifest.json"].format).toBe("portiq-workspace-tree");
    expect(files["workspace/settings.json"].activeCollectionId).toBe("c1");
    expect(files["workspace/environments/environments.json"]).toHaveLength(1);
    expect(files["workspace/collections/my-api__c1/collection.json"].name).toBe("My API");
    expect(files["workspace/collections/my-api__c1/get-user__r1.request.json"].id).toBe("r1");
    expect(files["workspace/collections/my-api__c1/sub__f1/folder.json"].type).toBe("folder");
    expect(files["workspace/collections/my-api__c1/sub__f1/items/post__r2.request.json"].id).toBe("r2");
  });

  it("sanitizes request secrets in the serialized tree", () => {
    const files = buildWorkspaceFiles(sample());
    const req = files["workspace/collections/my-api__c1/get-user__r1.request.json"];
    expect(String(req.authConfig.bearer.token).startsWith("__PORTIQ_SECRET__:")).toBe(true);
  });

  it("slugifies ids so hostile ids cannot escape the workspace tree", () => {
    const evil: AppState = {
      collections: [{
        id: "../../evil", name: "C",
        items: [
          { type: "request", id: "../x", name: "R", description: "", tags: [], protocol: "http", method: "GET", url: "https://x" } as any,
        ],
      }],
      activeCollectionId: "../../evil",
      environments: [],
      activeEnvId: null,
      historyRetentionDays: 7,
    };
    const files = buildWorkspaceFiles(evil);
    const collectionPaths = Object.keys(files).filter((p) => p.endsWith("/collection.json"));
    expect(collectionPaths).toEqual(["workspace/collections/c__evil/collection.json"]);
    expect(Object.keys(files).some((p) => p.startsWith("..") || p.includes("../"))).toBe(false);
    const reqPath = Object.keys(files).find((p) => p.endsWith(".request.json"))!;
    expect(reqPath.startsWith("workspace/collections/")).toBe(true);
    expect(reqPath).toBe("workspace/collections/c__evil/r__x.request.json");
  });

  it("masks env vars whose id is in the masked set", () => {
    const files = buildWorkspaceFiles(sample(), new Set(["e1::0"]));
    expect(files["workspace/environments/environments.json"][0].vars[0].value).toBe("<SECRET_STORED_LOCALLY>");
  });
});

describe("previewMaskableVars", () => {
  it("flags likely-secret vars for masking", () => {
    const preview = previewMaskableVars([{ id: "e1", name: "L", vars: [{ key: "token", value: "x" }, { key: "page", value: "1" }] }]);
    expect(preview[0].vars[0].shouldMask).toBe(true);
    expect(preview[0].vars[1].shouldMask).toBe(false);
  });
});

describe("buildHistoryFiles", () => {
  it("bins a history entry under workspace/history/<day>/<collection>/root", () => {
    const history = [{
      timestamp: Date.parse("2026-07-23T10:00:00Z"),
      request: { requestId: "r1", requestName: "Get User", collectionName: "My API", collectionId: "c1", folderPath: [] },
      response: { status: 200 },
    }];
    const files = buildHistoryFiles(history, []);
    const paths = Object.keys(files);
    expect(paths).toHaveLength(1);
    expect(paths[0].startsWith("workspace/history/2026-07-23/my-api__c1/root/")).toBe(true);
    expect(paths[0].endsWith("__get-user__0.json")).toBe(true);
  });

  it("skips entries without a timestamp", () => {
    expect(Object.keys(buildHistoryFiles([{ request: {} }], []))).toHaveLength(0);
  });
});
