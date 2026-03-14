import { useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

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
    testsPreText?: string;
    testsPostText?: string;
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
    wsConfig?: WsConfig;
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

export function useRequestState() {
    const [method, setMethod] = useLocalStorage<string>("ui_method", "GET");
    const [url, setUrl] = useLocalStorage<string>("ui_url", "https://api.example.com/users");
    const [headersText, setHeadersText] = useLocalStorage<string>("ui_headersText", '{\n  "Content-Type": "application/json"\n}');
    const [bodyText, setBodyText] = useLocalStorage<string>("ui_bodyText", "");
    const [testsPreText, setTestsPreText] = useLocalStorage<string>("ui_testsPreText", "");
    const [testsPostText, setTestsPostText] = useLocalStorage<string>("ui_testsPostText", "");
    const [testsInputText, setTestsInputText] = useLocalStorage<string>("ui_testsInputText", '{\n  "status": 200,\n  "body": {"ok": true}\n}');
    const [paramsRows, setParamsRows] = useLocalStorage<RequestRow[]>("ui_paramsRows", [{ key: "", value: "", comment: "", enabled: true }]);
    const [headersRows, setHeadersRows] = useLocalStorage<RequestRow[]>("ui_headersRows", [{ key: "Content-Type", value: "application/json", comment: "", enabled: true }]);
    const [authRows, setAuthRows] = useLocalStorage<RequestRow[]>("ui_authRows", [{ key: "Authorization", value: "Bearer <token>", comment: "", enabled: false }]);
    const [authType, setAuthType] = useLocalStorage<string>("ui_authType", "none");
    const [authConfig, setAuthConfig] = useLocalStorage<AuthConfig>("ui_authConfig", {
        bearer: { token: "" },
        basic: { username: "", password: "" },
        api_key: { key: "", value: "", add_to: "header" }
    });
    const [httpVersion, setHttpVersion] = useLocalStorage<string>("ui_httpVersion", "auto");
    const [requestTimeoutMs, setRequestTimeoutMs] = useLocalStorage<number>("ui_requestTimeoutMs", 30000);
    const [bodyType, setBodyType] = useLocalStorage<string>("ui_bodyType", "json");
    const [bodyRows, setBodyRows] = useLocalStorage<RequestRow[]>("ui_bodyRows", [{ key: "", value: "", comment: "", enabled: true }]);
    const [graphqlConfig, setGraphqlConfig] = useLocalStorage<GraphqlConfig>("ui_graphqlConfig", {
        query: "",
        variables: "{}",
        operationName: "",
        headers: {}
    });
    const [wsConfig, setWsConfig] = useLocalStorage<WsConfig>("ui_wsConfig", {
        headersText: "{\n}",
        headersRows: [{ key: "", value: "", comment: "", enabled: true }],
        headersMode: "table",
        protocolsText: "",
        protocolRows: [{ key: "", value: "", comment: "", enabled: true }],
        autoReconnect: false,
        reconnectInterval: 3000,
        connectTimeout: 10000,
        messageType: "text",
        messages: [] as WsMessage[]
    });

    const [requestName, setRequestName] = useLocalStorage<string>("ui_requestName", "/users");
    const [currentRequestId, setCurrentRequestId] = useLocalStorage<string>("ui_currentRequestId", "");
    const [protocol, setProtocol] = useLocalStorage<string>("ui_protocol", "http");
    const [collectionActiveRequestIds, setCollectionActiveRequestIds] = useLocalStorage<Record<string, string>>("ui_collectionActiveRequestIds", {});

    const [collections, setCollections] = useLocalStorage<Collection[]>("ui_collections", [
        {
            id: "col-default",
            name: "Users API",
            items: [
                {
                    type: "folder",
                    id: "fld-users",
                    name: "Users",
                    items: [
                        {
                            type: "request",
                            id: "req-1",
                            name: "List Users",
                            description: "Fetches the user list",
                            tags: ["list", "users"],
                            protocol: "http",
                            method: "GET",
                            url: "https://api.example.com/users"
                        },
                        {
                            type: "request",
                            id: "req-2",
                            name: "Create User",
                            description: "Creates a new user",
                            tags: ["create", "users"],
                            protocol: "http",
                            method: "POST",
                            url: "https://api.example.com/users"
                        }
                    ]
                }
            ]
        }
    ]);
    const [activeCollectionId, setActiveCollectionId] = useLocalStorage<string>("ui_activeCollectionId", "col-default");

    function getActiveCollection(): Collection | null {
        if (!Array.isArray(collections) || collections.length === 0) return null;
        return collections.find((col) => col.id === activeCollectionId) || collections[0];
    }

    function addCollection() {
        const id = `col-${Date.now()}`;
        const next: Collection = { id, name: `Collection ${collections.length + 1}`, items: [] };
        setCollections((prev) => [...prev, next]);
        setActiveCollectionId(id);
    }

    function duplicateCollection(collectionId: string) {
        const colToCopy = collections.find(c => c.id === collectionId);
        if (!colToCopy) return;

        const deepCloneWithNewIds = (item: any): any => {
            const cloned = JSON.parse(JSON.stringify(item));
            const recreateIds = (node: any) => {
                if (node.type === "folder") node.id = `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                else if (node.type === "request") node.id = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                if (node.items) node.items.forEach(recreateIds);
            };
            if (cloned.items) cloned.items.forEach(recreateIds);
            return cloned;
        };

        const cloned = deepCloneWithNewIds(colToCopy);
        cloned.id = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        cloned.name = `${cloned.name} Copy`;

        setCollections(prev => [...prev, cloned]);
        setActiveCollectionId(cloned.id);
    }

    function updateCollectionName(value: string) {
        setCollections((prev) =>
            prev.map((col) => (col.id === activeCollectionId ? { ...col, name: value } : col))
        );
    }

    function addRequestToCollection(folderId: string | null = null, setupNewRequest = (req: RequestItem) => { }): RequestItem | null {
        const col = getActiveCollection();
        if (!col) return null;
        const id = `req-${Date.now()}`;
        const name = "New Request";
        const req: RequestItem = {
            type: "request",
            id,
            name,
            description: "",
            tags: [],
            protocol: "http",
            method: "GET",
            url: "",
            headersText: "",
            bodyText: "",
            testsPreText: "",
            testsPostText: "",
            testsInputText: "",
            httpVersion: "auto",
            requestTimeoutMs: 30000,
            bodyType: "json",
            paramsRows: [{ key: "", value: "", comment: "", enabled: true }],
            headersRows: [{ key: "", value: "", comment: "", enabled: true }],
            authRows: [{ key: "", value: "", comment: "", enabled: false }],
            bodyRows: [{ key: "", value: "", comment: "", enabled: true }],
            graphqlConfig: {
                query: "",
                variables: "{}",
                operationName: "",
                headers: {}
            },
            wsConfig: {
                headersText: "{\n}",
                headersRows: [{ key: "", value: "", comment: "", enabled: true }],
                headersMode: "table",
                protocolsText: "",
                protocolRows: [{ key: "", value: "", comment: "", enabled: true }],
                autoReconnect: false,
                reconnectInterval: 3000,
                connectTimeout: 10000,
                messageType: "text",
                messages: []
            }
        };

        // Allow the caller to customise the request (e.g. set protocol) before it is inserted
        setupNewRequest(req);

        if (!folderId) {
            const nextItems = Array.isArray(col.items) ? [...col.items, req] : [req];
            setCollections((prev) =>
                prev.map((item) => (item.id === col.id ? { ...item, items: nextItems } : item))
            );
            return req;
        }

        const insertIntoFolder = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] => {
            return items.map(item => {
                if (item.type === "folder") {
                    if (item.id === folderId) {
                        return { ...item, items: [...(item.items || []), req] };
                    }
                    return { ...item, items: insertIntoFolder(item.items || []) };
                }
                return item;
            });
        };

        setCollections((prev) =>
            prev.map((item) => (item.id === col.id ? { ...item, items: insertIntoFolder(item.items || []) } : item))
        );
        return req;
    }

    function loadRequest(req: RequestItem | null) {
        if (!req) {
            setRequestName("New Request");
            setCurrentRequestId("");
            setProtocol("http");
            setMethod("GET");
            setUrl("");
            setHeadersText("");
            setBodyText("");
            setTestsPreText("");
            setTestsPostText("");
            setHeadersRows([{ key: "", value: "", comment: "", enabled: true }]);
            setParamsRows([{ key: "", value: "", comment: "", enabled: true }]);
            setAuthRows([{ key: "", value: "", comment: "", enabled: false }]);
            setAuthType("none");
            setHttpVersion("auto");
            setRequestTimeoutMs(30000);
            setBodyType("json");
            setBodyRows([{ key: "", value: "", comment: "", enabled: true }]);
            const setQuery = (v: string) => setGraphqlConfig((prev: GraphqlConfig) => ({ ...prev, query: v }));
            const setVariables = (v: string) => setGraphqlConfig((prev: GraphqlConfig) => ({ ...prev, variables: v }));
            const setOperationName = (v: string) => setGraphqlConfig((prev: GraphqlConfig) => ({ ...prev, operationName: v }));
            const setHeaders = (v: Record<string, string>) => setGraphqlConfig((prev: GraphqlConfig) => ({ ...prev, headers: v }));
            setGraphqlConfig({
                query: "",
                variables: "{}",
                operationName: "",
                headers: {}
            });
            setWsConfig({
                headersText: "{\n}",
                headersRows: [{ key: "", value: "", comment: "", enabled: true }],
                headersMode: "table",
                protocolsText: "",
                protocolRows: [{ key: "", value: "", comment: "", enabled: true }],
                autoReconnect: false,
                reconnectInterval: 3000,
                connectTimeout: 10000,
                messageType: "text",
                messages: []
            });
            return;
        };
        setRequestName(req.name || "New Request");
        setCurrentRequestId(req.id || "");
        setProtocol(req.protocol || "http");
        setMethod(req.method || "GET");
        setUrl(req.url || "");
        setHeadersText(req.headersText || "");
        setBodyText(req.bodyText || "");
        setTestsPreText(req.testsPreText || "");
        setTestsPostText(req.testsPostText || "");
        setTestsInputText(req.testsInputText || "{\n  \"status\": 200,\n  \"body\": {\"ok\": true}\n}");
        setHttpVersion(req.httpVersion || "auto");
        setRequestTimeoutMs(req.requestTimeoutMs || 30000);
        setBodyType(req.bodyType || "json");
        setGraphqlConfig(req.graphqlConfig || {
            query: "",
            variables: "{}",
            operationName: "",
            headers: {}
        });
        setWsConfig(req.wsConfig || {
            headersText: "{\n}",
            headersRows: [{ key: "", value: "", comment: "", enabled: true }],
            headersMode: "table",
            protocolsText: "",
            protocolRows: [{ key: "", value: "", comment: "", enabled: true }],
            autoReconnect: false,
            reconnectInterval: 3000,
            connectTimeout: 10000,
            messageType: "text",
            messages: []
        });
        setParamsRows(req.paramsRows || [{ key: "", value: "", comment: "", enabled: true }]);
        setHeadersRows(req.headersRows || [{ key: "", value: "", comment: "", enabled: true }]);
        setAuthRows(req.authRows || [{ key: "", value: "", comment: "", enabled: false }]);

        if (req.authType) {
            setAuthType(req.authType);
        } else {
            const hasActiveAuth = req.authRows && req.authRows.some(r => r.key && r.enabled);
            setAuthType(hasActiveAuth ? "custom" : "none");
        }

        setAuthConfig(req.authConfig || {
            bearer: { token: "" },
            basic: { username: "", password: "" },
            api_key: { key: "", value: "", add_to: "header" }
        });

        setBodyRows(req.bodyRows || [{ key: "", value: "", comment: "", enabled: true }]);

        if (activeCollectionId && req.id) {
            setCollectionActiveRequestIds(prev => ({ ...prev, [activeCollectionId]: req.id }));
        }
    }

    function syncDraftToCollection() {
        if (!currentRequestId || !activeCollectionId) return;

        const draft: Partial<RequestItem> = {
            protocol,
            method,
            url,
            headersText,
            bodyText,
            testsPreText,
            testsPostText,
            testsInputText,
            httpVersion,
            requestTimeoutMs,
            paramsRows,
            headersRows,
            authRows,
            authType,
            authConfig,
            bodyType,
            bodyRows,
            graphqlConfig,
            wsConfig,
            name: requestName
        };

        const updateItems = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
            items.map((item) => {
                if (item.type === "folder") {
                    return { ...item, items: updateItems(item.items || []) };
                }
                if (item.type === "request" && item.id === currentRequestId) {
                    return { ...item, ...draft };
                }
                return item;
            });

        setCollections((prev) =>
            prev.map((col) =>
                col.id === activeCollectionId ? { ...col, items: updateItems(col.items || []) } : col
            )
        );
    }

    function updateRequestState(requestId: string, field: string, value: any) {
        const updateItems = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
            items.map((item) => {
                if (item.type === "folder") {
                    return { ...item, items: updateItems(item.items || []) };
                }
                if (item.type === "request" && item.id === requestId) {
                    return { ...item, [field]: value };
                }
                return item;
            });
        setCollections((prev) =>
            prev.map((col) =>
                col.id === activeCollectionId ? { ...col, items: updateItems(col.items || []) } : col
            )
        );
    }

    function updateRequestName(requestId: string, name: string) {
        updateRequestState(requestId, "name", name);
    }

    function updateRequestMethod(requestId: string, method: string) {
        updateRequestState(requestId, "method", method);
    }

    function updateRequestById(requestId: string, updates: Partial<RequestItem>) {
        const updateItems = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
            items.map((item) => {
                if (item.type === "folder") {
                    return { ...item, items: updateItems(item.items || []) };
                }
                if (item.type === "request" && item.id === requestId) {
                    return { ...item, ...updates };
                }
                return item;
            });
        setCollections((prev) =>
            prev.map((col) => ({
                ...col,
                items: updateItems(col.items || [])
            }))
        );
    }

    function deleteRequest(requestId: string) {
        const filterItems = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
            items
                .filter((item) => !(item.type === "request" && item.id === requestId))
                .map((item) => {
                    if (item.type === "folder") {
                        return { ...item, items: filterItems(item.items || []) };
                    }
                    return item;
                });
        setCollections((prev) =>
            prev.map((col) =>
                col.id === activeCollectionId ? { ...col, items: filterItems(col.items || []) } : col
            )
        );
    }

    function addFolderToCollection(parentFolderId: string | null = null, setupNewFolder = (id: string) => { }): string | null {
        const col = getActiveCollection();
        if (!col) return null;
        const id = `fld-${Date.now()}`;
        const folder: FolderItem = { type: "folder", id, name: "New Folder", items: [] };

        if (!parentFolderId) {
            const nextItems = Array.isArray(col.items) ? [...col.items, folder] : [folder];
            setCollections((prev) =>
                prev.map((item) => (item.id === col.id ? { ...item, items: nextItems } : item))
            );
        } else {
            const insertIntoFolder = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] => {
                return items.map(item => {
                    if (item.type === "folder") {
                        if (item.id === parentFolderId) {
                            return { ...item, items: [...(item.items || []), folder] };
                        }
                        return { ...item, items: insertIntoFolder(item.items || []) };
                    }
                    return item;
                });
            };

            setCollections((prev) =>
                prev.map((item) => (item.id === col.id ? { ...item, items: insertIntoFolder(item.items || []) } : item))
            );
        }

        setupNewFolder(id);
        return id;
    }

    function updateFolderName(folderId: string, name: string) {
        const updateItems = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
            items.map((item) => {
                if (item.type === "folder") {
                    if (item.id === folderId) {
                        return { ...item, name };
                    }
                    return { ...item, items: updateItems(item.items || []) };
                }
                return item;
            });
        setCollections((prev) =>
            prev.map((col) =>
                col.id === activeCollectionId ? { ...col, items: updateItems(col.items || []) } : col
            )
        );
    }

    function deleteFolder(folderId: string) {
        const filterItems = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
            items
                .filter((item) => !(item.type === "folder" && item.id === folderId))
                .map((item) => {
                    if (item.type === "folder") {
                        return { ...item, items: filterItems(item.items || []) };
                    }
                    return item;
                });
        setCollections((prev) =>
            prev.map((col) =>
                col.id === activeCollectionId ? { ...col, items: filterItems(col.items || []) } : col
            )
        );
    }

    function moveItemInCollection(sourceId: string, targetId: string | null, isTargetFolder: boolean) {
        if (sourceId === targetId) return;

        setCollections(prev => prev.map(col => {
            if (col.id !== activeCollectionId) return col;

            const clonedCol: Collection = JSON.parse(JSON.stringify(col));
            let itemToMove: FolderItem | RequestItem | undefined = undefined;

            const findAndRemove = (arr: (FolderItem | RequestItem)[]): boolean => {
                for (let i = 0; i < arr.length; i++) {
                    if (arr[i].id === sourceId) {
                        itemToMove = arr.splice(i, 1)[0];
                        return true;
                    }
                    if (arr[i].type === "folder" && (arr[i] as FolderItem).items) {
                        if (findAndRemove((arr[i] as FolderItem).items)) return true;
                    }
                }
                return false;
            };

            findAndRemove(clonedCol.items);

            if (!itemToMove) return col;
            const moved = itemToMove as (FolderItem | RequestItem);

            if (moved.type === "folder" && isTargetFolder && targetId) {
                let isTargetDescendant = false;
                const checkDescendant = (arr: (FolderItem | RequestItem)[] | undefined) => {
                    if (!arr) return;
                    for (const child of arr) {
                        if (child.id === targetId) isTargetDescendant = true;
                        if (child.type === "folder") checkDescendant((child as FolderItem).items);
                    }
                };
                checkDescendant((itemToMove as FolderItem).items);
                if (isTargetDescendant) return col;
            }

            if (!targetId) {
                clonedCol.items.push(itemToMove);
            } else {
                let inserted = false;
                const insertItem = (arr: (FolderItem | RequestItem)[]) => {
                    if (inserted) return;
                    for (let i = 0; i < arr.length; i++) {
                        if (arr[i].id === targetId) {
                            if (isTargetFolder) {
                                if (!(arr[i] as FolderItem).items) (arr[i] as FolderItem).items = [];
                                (arr[i] as FolderItem).items.push(itemToMove!);
                            } else {
                                arr.splice(i + 1, 0, itemToMove!);
                            }
                            inserted = true;
                            return;
                        }
                        if (arr[i].type === "folder" && (arr[i] as FolderItem).items) {
                            insertItem((arr[i] as FolderItem).items);
                        }
                    }
                };
                insertItem(clonedCol.items);

                if (!inserted) clonedCol.items.push(itemToMove);
            }

            return clonedCol;
        }));
    }

    function duplicateItem(itemId: string) {
        const recreateIds = (node: any) => {
            if (node.type === "folder") node.id = `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            else if (node.type === "request") node.id = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            if (node.items) node.items.forEach(recreateIds);
        };

        const duplicateInArray = (items: (FolderItem | RequestItem)[]): { modified: boolean, items: (FolderItem | RequestItem)[] } => {
            const idx = items.findIndex(i => i.id === itemId);
            if (idx !== -1) {
                const cloned = JSON.parse(JSON.stringify(items[idx]));
                recreateIds(cloned);
                cloned.name = `${cloned.name} Copy`;
                const newItems = [...items];
                newItems.splice(idx + 1, 0, cloned);
                return { modified: true, items: newItems };
            }

            let modified = false;
            const newItems = items.map(item => {
                if (item.type === "folder") {
                    const res = duplicateInArray((item as FolderItem).items || []);
                    if (res.modified) {
                        modified = true;
                        return { ...item, items: res.items } as FolderItem;
                    }
                }
                return item;
            });
            return { modified, items: newItems };
        };

        setCollections((prev) =>
            prev.map((col) => {
                if (col.id === activeCollectionId) {
                    const res = duplicateInArray(col.items || []);
                    if (res.modified) {
                        return { ...col, items: res.items };
                    }
                }
                return col;
            })
        );
    }

    function getAllFolders(items: (FolderItem | RequestItem)[], depth = 0, prefix = ""): { id: string, name: string, depth: number }[] {
        let folders: { id: string, name: string, depth: number }[] = [];
        if (!items) return folders;
        for (const item of items) {
            if (item.type === "folder") {
                const fullPath = prefix ? `${prefix} / ${item.name}` : item.name;
                folders.push({ id: item.id, name: fullPath, depth });
                if (Array.isArray((item as FolderItem).items)) {
                    folders = folders.concat(getAllFolders((item as FolderItem).items, depth + 1, fullPath));
                }
            }
        }
        return folders;
    }

    function parseImportData(imported: any): Collection | null | false {
        let collection: Collection | null = null;

        if (imported.meta && imported.meta.format === "httpie") {
            const colId = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            collection = {
                id: colId,
                name: imported.entry?.name || "HTTPie Import",
                items: []
            } as Collection;

            const requests = (imported.entry?.requests || []) as any[];

            requests.forEach((req, idx) => {
                const parts = (req.name || `Request ${idx}`).split(' / ').map((p: string) => p.trim());
                // Only treat it as folders if there's an overarching collection name matches the first part
                if (parts.length > 1 && parts[0] === collection?.name) {
                    parts.shift(); // Remove the root collection name from the folders path
                }

                const reqName = parts.pop();

                let currentItems = collection!.items;
                parts.forEach((part: string) => {
                    let found = currentItems.find(i => i.type === "folder" && i.name === part) as FolderItem;
                    if (!found) {
                        found = {
                            type: "folder",
                            id: `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                            name: part,
                            items: []
                        };
                        currentItems.push(found);
                    }
                    currentItems = found.items;
                });

                const parsedReq: RequestItem = {
                    type: "request",
                    id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    name: reqName!,
                    description: "",
                    tags: [],
                    protocol: "http",
                    method: req.method || "GET",
                    url: req.url || "",
                    headersRows: (req.headers || []).map((h: any) => ({ key: h.name, value: h.value, comment: "", enabled: true })),
                    paramsRows: (req.queryParams || []).map((q: any) => ({ key: q.name, value: q.value, comment: "", enabled: true })),
                    authRows: [{ key: "", value: "", comment: "", enabled: false }],
                    httpVersion: "auto",
                    requestTimeoutMs: 30000,
                    bodyRows: [{ key: "", value: "", comment: "", enabled: true }],
                    authType: "none",
                    authConfig: {
                        bearer: { token: "" },
                        basic: { username: "", password: "" },
                        api_key: { key: "", value: "", add_to: "header" }
                    }
                };

                // Extract auth from HTTPie headers
                const authHeader = (req.headers || []).find((h: any) => h.name?.toLowerCase() === "authorization");
                if (authHeader && authHeader.value) {
                    const authValue = authHeader.value as string;
                    if (authValue.toLowerCase().startsWith("bearer ")) {
                        parsedReq.authType = "bearer";
                        parsedReq.authConfig!.bearer.token = authValue.substring(7);
                        // Remove the auth header from headersRows since it's now in authConfig
                        parsedReq.headersRows = parsedReq.headersRows!.filter(
                            h => h.key?.toLowerCase() !== "authorization"
                        );
                    } else if (authValue.toLowerCase().startsWith("basic ")) {
                        try {
                            const decoded = atob(authValue.substring(6));
                            const [username, ...rest] = decoded.split(":");
                            parsedReq.authType = "basic";
                            parsedReq.authConfig!.basic = { username, password: rest.join(":") };
                            parsedReq.headersRows = parsedReq.headersRows!.filter(
                                h => h.key?.toLowerCase() !== "authorization"
                            );
                        } catch (e) {
                            // If decoding fails, keep as custom auth header
                        }
                    }
                }

                if (req.body?.type === "text" && req.body?.text?.value) {
                    parsedReq.bodyType = "json";
                    parsedReq.bodyText = req.body.text.value;
                }
                if (req.body?.type === "form" && req.body?.form?.fields?.length > 0) {
                    parsedReq.bodyType = "form";
                    parsedReq.bodyRows = req.body.form.fields.map((f: any) => ({ key: f.name, value: f.value, comment: "", enabled: true }));
                }

                if (!parsedReq.headersRows || parsedReq.headersRows.length === 0) parsedReq.headersRows = [{ key: "", value: "", comment: "", enabled: true }];
                if (!parsedReq.paramsRows || parsedReq.paramsRows.length === 0) parsedReq.paramsRows = [{ key: "", value: "", comment: "", enabled: true }];

                currentItems.push(parsedReq);
            });
        } else if (imported.info && imported.info.schema && imported.info.schema.includes("postman.com/json/collection/v2.1.0")) {
            const colId = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            collection = {
                id: colId,
                name: imported.info.name || "Postman Import",
                items: []
            };

            const parsePostmanItem = (pmItem: any): FolderItem | RequestItem | null => {
                if (pmItem.item) {
                    return {
                        type: "folder",
                        id: `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        name: pmItem.name || "Imported Folder",
                        items: pmItem.item.map(parsePostmanItem).filter(Boolean)
                    };
                } else if (pmItem.request) {
                    const pmReq = pmItem.request;
                    const parsedReq: RequestItem = {
                        type: "request",
                        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        name: pmItem.name || "Imported Request",
                        description: "",
                        tags: [],
                        protocol: "http",
                        method: pmReq.method || "GET",
                        url: typeof pmReq.url === 'string' ? pmReq.url : (pmReq.url?.raw || ""),
                        headersRows: (pmReq.header || []).map((h: any) => ({ key: h.key, value: h.value, comment: "", enabled: true })),
                        paramsRows: (pmReq.url?.query || []).map((q: any) => ({ key: q.key, value: q.value, comment: "", enabled: true })),
                        authRows: [{ key: "", value: "", comment: "", enabled: false }],
                        httpVersion: "auto",
                        requestTimeoutMs: 30000,
                        bodyRows: [{ key: "", value: "", comment: "", enabled: true }],
                        authType: "none",
                        authConfig: {
                            bearer: { token: "" },
                            basic: { username: "", password: "" },
                            api_key: { key: "", value: "", add_to: "header" }
                        }
                    };

                    // Extract Postman auth settings
                    const pmAuth = pmReq.auth;
                    if (pmAuth) {
                        const authType = pmAuth.type;
                        if (authType === "bearer") {
                            const tokenEntry = (pmAuth.bearer || []).find((e: any) => e.key === "token");
                            parsedReq.authType = "bearer";
                            parsedReq.authConfig = {
                                ...parsedReq.authConfig!,
                                bearer: { token: tokenEntry?.value || "" }
                            };
                        } else if (authType === "basic") {
                            const userEntry = (pmAuth.basic || []).find((e: any) => e.key === "username");
                            const passEntry = (pmAuth.basic || []).find((e: any) => e.key === "password");
                            parsedReq.authType = "basic";
                            parsedReq.authConfig = {
                                ...parsedReq.authConfig!,
                                basic: { username: userEntry?.value || "", password: passEntry?.value || "" }
                            };
                        } else if (authType === "apikey") {
                            const keyEntry = (pmAuth.apikey || []).find((e: any) => e.key === "key");
                            const valEntry = (pmAuth.apikey || []).find((e: any) => e.key === "value");
                            const inEntry = (pmAuth.apikey || []).find((e: any) => e.key === "in");
                            parsedReq.authType = "api_key";
                            parsedReq.authConfig = {
                                ...parsedReq.authConfig!,
                                api_key: {
                                    key: keyEntry?.value || "",
                                    value: valEntry?.value || "",
                                    add_to: (inEntry?.value === "query") ? "query" : "header"
                                }
                            };
                        }
                    }

                    if (pmReq.body) {
                        const mode = pmReq.body.mode;
                        if (mode === 'raw') {
                            parsedReq.bodyType = "json";
                            parsedReq.bodyText = pmReq.body.raw || "";
                        } else if (mode === 'urlencoded') {
                            parsedReq.bodyType = "form";
                            parsedReq.bodyRows = (pmReq.body.urlencoded || []).map((p: any) => ({ key: p.key, value: p.value, comment: "", enabled: true }));
                        } else if (mode === 'formdata') {
                            parsedReq.bodyType = "multipart";
                            parsedReq.bodyRows = (pmReq.body.formdata || []).map((p: any) => ({ key: p.key, value: p.value, comment: "", enabled: true }));
                        }
                    }

                    if (!parsedReq.headersRows || parsedReq.headersRows.length === 0) parsedReq.headersRows = [{ key: "", value: "", comment: "", enabled: true }];
                    if (!parsedReq.paramsRows || parsedReq.paramsRows.length === 0) parsedReq.paramsRows = [{ key: "", value: "", comment: "", enabled: true }];

                    return parsedReq;
                }
                return null;
            };

            collection.items = (imported.item || []).map(parsePostmanItem).filter(Boolean);

        } else if (imported.id) {
            imported.id = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            collection = imported;
        }

        if (!collection) return null;
        return collection;
    }

    return {
        method, setMethod,
        url, setUrl,
        headersText, setHeadersText,
        bodyText, setBodyText,
        testsPreText, setTestsPreText,
        testsPostText, setTestsPostText,
        testsInputText, setTestsInputText,
        paramsRows, setParamsRows,
        headersRows, setHeadersRows,
        authRows, setAuthRows,
        authType, setAuthType,
        authConfig, setAuthConfig,
        httpVersion, setHttpVersion,
        requestTimeoutMs, setRequestTimeoutMs,
        bodyType, setBodyType,
        bodyRows, setBodyRows,
        graphqlConfig, setGraphqlConfig,
        wsConfig, setWsConfig,
        protocol, setProtocol,
        requestName, setRequestName,
        currentRequestId, setCurrentRequestId,
        collections, setCollections,
        activeCollectionId, setActiveCollectionId,
        getActiveCollection,
        addCollection,
        duplicateCollection,
        updateCollectionName,
        addRequestToCollection,
        loadRequest,
        updateRequestState,
        updateRequestName,
        updateRequestMethod,
        updateRequestById,
        deleteRequest,
        addFolderToCollection,
        updateFolderName,
        deleteFolder,
        moveItemInCollection,
        duplicateItem,
        getAllFolders,
        parseImportData,
        syncDraftToCollection,
        collectionActiveRequestIds,
        setCollectionActiveRequestIds
    };
}
