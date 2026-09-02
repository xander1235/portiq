import Fuse from "fuse.js";

export function flattenCollections(collections: any[]): any[] {
  const allRequests: any[] = [];

  const extractRequests = (items: any[], collectionId: string, collectionName: string) => {
    if (!items || !Array.isArray(items)) return;
    items.forEach((item: any) => {
      if (item.type === "request") {
        allRequests.push({ collectionId, collectionName, ...item });
      } else if (item.type === "folder" && item.items) {
        extractRequests(item.items, collectionId, collectionName);
      }
    });
  };

  collections.forEach((col: any) => {
    extractRequests(col.items, col.id, col.name);
    if (col.requests && Array.isArray(col.requests)) {
      col.requests.forEach((req: any) => {
        allRequests.push({ collectionId: col.id, collectionName: col.name, ...req });
      });
    }
  });

  return allRequests;
}

export function searchRequestsContext(prompt: string, collections: any[]): any[] {
  const allRequests = flattenCollections(collections);
  if (allRequests.length === 0) return [];

  const fuse = new Fuse(allRequests, {
    keys: ["name", "url", "method"],
    threshold: 0.3,
    ignoreLocation: true,
    includeScore: true,
  });

  const stopWords = ["find", "load", "open", "get", "fetch", "show", "the", "a", "an", "request", "endpoint", "api"];
  const cleanedPrompt = prompt.replace(/[^\w\s-]/gi, "").toLowerCase().trim();
  const tokens = cleanedPrompt.split(/\s+/).filter((t) => t.length > 1 && !stopWords.includes(t));
  const searchQuery = tokens.join(" ") || prompt;

  let results = fuse.search(searchQuery);
  results = results.filter((res) => res.score !== undefined && res.score < 0.4);

  return results.slice(0, 5).map((res) => {
    const r = res.item as any;
    return {
      id: r.id,
      collectionId: r.collectionId,
      collectionName: r.collectionName,
      name: r.name,
      method: r.method,
      url: r.url,
      authType: r.authType,
      headersText: r.headersText,
      bodyText: r.bodyText,
    };
  });
}

export function buildResponseContext(responseData: any): string {
  if (!responseData) return "No response data available yet.";
  let bodyStr = String(responseData.body || "");
  try {
    const parsed = JSON.parse(bodyStr);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
      const rawJsonStr = JSON.stringify(parsed);

      const schema = Array.from(new Set(parsed.flatMap((obj: any) => Object.keys(obj))));
      const tupleData = parsed.map((obj: any) => schema.map((k) => (obj[k] !== undefined ? obj[k] : null)));
      const tupleJsonStr = JSON.stringify({ __schema: schema, __data: tupleData });

      const dictItems = new Map<any, number>();
      const dictArray: any[] = [];
      const tupleDictData = parsed.map((obj: any) =>
        schema.map((k) => {
          const val = obj[k] !== undefined ? obj[k] : null;
          if (typeof val === "string" && val.length > 2) {
            if (!dictItems.has(val)) {
              dictItems.set(val, dictArray.length);
              dictArray.push(val);
            }
            return dictItems.get(val);
          }
          return val;
        }),
      );

      const dictJsonStr = dictArray.length > 0
        ? JSON.stringify({ __dict: dictArray, __schema: schema, __data: tupleDictData })
        : tupleJsonStr;

      const candidates = [
        { method: "Minified JSON", str: rawJsonStr, len: rawJsonStr.length },
        { method: "Schema-Tuple", str: `[Compressed using Schema-Tuple format]\n${tupleJsonStr}`, len: tupleJsonStr.length },
        { method: "Schema-Tuple+Dictionary", str: `[Compressed using Schema-Tuple + Dictionary Encoder]\n${dictJsonStr}`, len: dictJsonStr.length },
      ];

      candidates.sort((a, b) => a.len - b.len);
      bodyStr = candidates[0].str;
    } else {
      bodyStr = JSON.stringify(parsed);
    }
  } catch {
    // Not JSON or parsing failed; leave as-is.
  }

  const bodyLimit = 25000;
  const bodyPreview = bodyStr.substring(0, bodyLimit) + (bodyStr.length > bodyLimit ? `\n...[TRUNCATED: showing ${bodyLimit} of ${bodyStr.length} chars]` : "");
  return `Status: ${responseData.status || "N/A"} ${responseData.statusText || ""}\nHeaders: ${responseData.headers ? JSON.stringify(responseData.headers).substring(0, 600) : ""}\nBody (${bodyStr.length} chars total):\n${bodyPreview}`;
}

export function buildCollectionContext(collections: any[]): any[] {
  return (collections || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    folders: (c.items || []).filter((i: any) => i.type === "folder").map((f: any) => ({ id: f.id, name: f.name })),
    requestCount: (c.items || []).filter((i: any) => i.type === "request").length,
  }));
}
