import { useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

export function useRequestState() {
    const [method, setMethod] = useLocalStorage("ui_method", "GET");
    const [url, setUrl] = useLocalStorage("ui_url", "https://api.example.com/users");
    const [headersText, setHeadersText] = useLocalStorage("ui_headersText", '{\n  "Content-Type": "application/json"\n}');
    const [bodyText, setBodyText] = useLocalStorage("ui_bodyText", "");
    const [testsPreText, setTestsPreText] = useLocalStorage("ui_testsPreText", "");
    const [testsPostText, setTestsPostText] = useLocalStorage("ui_testsPostText", "");
    const [testsInputText, setTestsInputText] = useLocalStorage("ui_testsInputText", '{\n  "status": 200,\n  "body": {"ok": true}\n}');
    const [paramsRows, setParamsRows] = useLocalStorage("ui_paramsRows", [{ key: "", value: "", comment: "", enabled: true }]);
    const [headersRows, setHeadersRows] = useLocalStorage("ui_headersRows", [{ key: "Content-Type", value: "application/json", comment: "", enabled: true }]);
    const [authRows, setAuthRows] = useLocalStorage("ui_authRows", [{ key: "Authorization", value: "Bearer <token>", comment: "", enabled: false }]);
    const [authType, setAuthType] = useLocalStorage("ui_authType", "none");
    const [authConfig, setAuthConfig] = useLocalStorage("ui_authConfig", {
        bearer: { token: "" },
        basic: { username: "", password: "" },
        api_key: { key: "", value: "", add_to: "header" }
    });
    const [bodyType, setBodyType] = useLocalStorage("ui_bodyType", "json");
    const [bodyRows, setBodyRows] = useLocalStorage("ui_bodyRows", [{ key: "", value: "", comment: "", enabled: true }]);
    const [graphqlConfig, setGraphqlConfig] = useLocalStorage("ui_graphqlConfig", {
        query: "",
        variables: "{}",
        operationName: "",
        headers: {}
    });
    const [wsConfig, setWsConfig] = useLocalStorage("ui_wsConfig", {
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

    const [requestName, setRequestName] = useLocalStorage("ui_requestName", "/users");
    const [currentRequestId, setCurrentRequestId] = useLocalStorage("ui_currentRequestId", "");
    const [protocol, setProtocol] = useLocalStorage("ui_protocol", "http");
    const [collectionActiveRequestIds, setCollectionActiveRequestIds] = useLocalStorage("ui_collectionActiveRequestIds", {});

    const [collections, setCollections] = useLocalStorage("ui_collections", [
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
                            method: "GET",
                            url: "https://api.example.com/users"
                        },
                        {
                            type: "request",
                            id: "req-2",
                            name: "Create User",
                            description: "Creates a new user",
                            tags: ["create", "users"],
                            method: "POST",
                            url: "https://api.example.com/users"
                        }
                    ]
                }
            ]
        }
    ]);
    const [activeCollectionId, setActiveCollectionId] = useLocalStorage("ui_activeCollectionId", "col-default");

    function getActiveCollection() {
        if (!Array.isArray(collections) || collections.length === 0) return null;
        return collections.find((col) => col.id === activeCollectionId) || collections[0];
    }

    function addCollection() {
        const id = `col-${Date.now()}`;
        const next = { id, name: `Collection ${collections.length + 1}`, items: [] };
        setCollections((prev) => [...prev, next]);
        setActiveCollectionId(id);
    }

    function duplicateCollection(collectionId) {
        const colToCopy = collections.find(c => c.id === collectionId);
        if (!colToCopy) return;

        const deepCloneWithNewIds = (item) => {
            const cloned = JSON.parse(JSON.stringify(item));
            const recreateIds = (node) => {
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

    function updateCollectionName(value) {
        setCollections((prev) =>
            prev.map((col) => (col.id === activeCollectionId ? { ...col, name: value } : col))
        );
    }

    function addRequestToCollection(folderId = null, setupNewRequest = (req) => { }) {
        const col = getActiveCollection();
        if (!col) return null;
        const id = `req-${Date.now()}`;
        const name = "New Request";
        const req = {
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
            bodyType: "json",
            paramsRows: [{ key: "", value: "", enabled: true }],
            headersRows: [{ key: "", value: "", enabled: true }],
            authRows: [{ key: "", value: "", enabled: false }],
            bodyRows: [{ key: "", value: "", enabled: true }],
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

        const insertIntoFolder = (items) => {
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

    function loadRequest(req) {
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
            setHeadersRows([{ key: "", value: "", enabled: true }]);
            setParamsRows([{ key: "", value: "", enabled: true }]);
            setAuthRows([{ key: "", value: "", enabled: false }]);
            setAuthType("none");
            setBodyType("json");
            setBodyRows([{ key: "", value: "", enabled: true }]);
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
        setParamsRows(req.paramsRows || [{ key: "", value: "", enabled: true }]);
        setHeadersRows(req.headersRows || [{ key: "", value: "", enabled: true }]);
        setAuthRows(req.authRows || [{ key: "", value: "", enabled: false }]);

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

        setBodyRows(req.bodyRows || [{ key: "", value: "", enabled: true }]);

        if (activeCollectionId && req.id) {
            setCollectionActiveRequestIds(prev => ({ ...prev, [activeCollectionId]: req.id }));
        }
    }

    function syncDraftToCollection() {
        if (!currentRequestId || !activeCollectionId) return;

        const draft = {
            protocol,
            method,
            url,
            headersText,
            bodyText,
            testsPreText,
            testsPostText,
            testsInputText,
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

        const updateItems = (items) =>
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

    function updateRequestState(requestId, field, value) {
        const updateItems = (items) =>
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

    function updateRequestName(requestId, name) {
        updateRequestState(requestId, "name", name);
    }

    function updateRequestMethod(requestId, method) {
        updateRequestState(requestId, "method", method);
    }

    function deleteRequest(requestId) {
        const filterItems = (items) =>
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

    function addFolderToCollection(parentFolderId = null, setupNewFolder = (id) => { }) {
        const col = getActiveCollection();
        if (!col) return null;
        const id = `fld-${Date.now()}`;
        const folder = { type: "folder", id, name: "New Folder", items: [] };

        if (!parentFolderId) {
            const nextItems = Array.isArray(col.items) ? [...col.items, folder] : [folder];
            setCollections((prev) =>
                prev.map((item) => (item.id === col.id ? { ...item, items: nextItems } : item))
            );
        } else {
            const insertIntoFolder = (items) => {
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

    function updateFolderName(folderId, name) {
        const updateItems = (items) =>
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

    function deleteFolder(folderId) {
        const filterItems = (items) =>
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

    function moveItemInCollection(sourceId, targetId, isTargetFolder) {
        if (sourceId === targetId) return;

        setCollections(prev => prev.map(col => {
            if (col.id !== activeCollectionId) return col;

            const clonedCol = JSON.parse(JSON.stringify(col));
            let itemToMove = null;

            const findAndRemove = (arr) => {
                for (let i = 0; i < arr.length; i++) {
                    if (arr[i].id === sourceId) {
                        itemToMove = arr.splice(i, 1)[0];
                        return true;
                    }
                    if (arr[i].type === "folder" && arr[i].items) {
                        if (findAndRemove(arr[i].items)) return true;
                    }
                }
                return false;
            };

            findAndRemove(clonedCol.items);

            if (!itemToMove) return col;

            if (itemToMove.type === "folder" && isTargetFolder) {
                let isTargetDescendant = false;
                const checkDescendant = (arr) => {
                    if (!arr) return;
                    for (const child of arr) {
                        if (child.id === targetId) isTargetDescendant = true;
                        if (child.type === "folder") checkDescendant(child.items);
                    }
                };
                checkDescendant(itemToMove.items);
                if (isTargetDescendant) return col;
            }

            if (!targetId) {
                clonedCol.items.push(itemToMove);
            } else {
                let inserted = false;
                const insertItem = (arr) => {
                    if (inserted) return;
                    for (let i = 0; i < arr.length; i++) {
                        if (arr[i].id === targetId) {
                            if (isTargetFolder) {
                                if (!arr[i].items) arr[i].items = [];
                                arr[i].items.push(itemToMove);
                            } else {
                                arr.splice(i + 1, 0, itemToMove);
                            }
                            inserted = true;
                            return;
                        }
                        if (arr[i].type === "folder" && arr[i].items) {
                            insertItem(arr[i].items);
                        }
                    }
                };
                insertItem(clonedCol.items);

                if (!inserted) clonedCol.items.push(itemToMove);
            }

            return clonedCol;
        }));
    }

    function duplicateItem(itemId) {
        const recreateIds = (node) => {
            if (node.type === "folder") node.id = `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            else if (node.type === "request") node.id = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            if (node.items) node.items.forEach(recreateIds);
        };

        const duplicateInArray = (items) => {
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
                    const res = duplicateInArray(item.items || []);
                    if (res.modified) {
                        modified = true;
                        return { ...item, items: res.items };
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

    function getAllFolders(items, depth = 0, prefix = "") {
        let folders = [];
        if (!items) return folders;
        for (const item of items) {
            if (item.type === "folder") {
                const fullPath = prefix ? `${prefix} / ${item.name}` : item.name;
                folders.push({ id: item.id, name: fullPath, depth });
                if (Array.isArray(item.items)) {
                    folders = folders.concat(getAllFolders(item.items, depth + 1, fullPath));
                }
            }
        }
        return folders;
    }

    function parseImportData(imported) {
        let collection = null;

        if (imported.meta && imported.meta.format === "httpie") {
            const colId = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            collection = {
                id: colId,
                name: imported.entry?.name || "HTTPie Import",
                items: []
            };

            const requests = imported.entry?.requests || [];

            requests.forEach((req, idx) => {
                const parts = (req.name || `Request ${idx}`).split(' / ').map(p => p.trim());
                // Only treat it as folders if there's an overarching collection name matches the first part
                if (parts.length > 1 && parts[0] === collection.name) {
                    parts.shift(); // Remove the root collection name from the folders path
                }

                const reqName = parts.pop();

                let currentItems = collection.items;
                parts.forEach(part => {
                    let found = currentItems.find(i => i.type === "folder" && i.name === part);
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

                const parsedReq = {
                    type: "request",
                    id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    name: reqName,
                    method: req.method || "GET",
                    url: req.url || "",
                    headersRows: (req.headers || []).map(h => ({ key: h.name, value: h.value, enabled: true })),
                    paramsRows: (req.queryParams || []).map(q => ({ key: q.name, value: q.value, enabled: true })),
                    authRows: [{ key: "", value: "", enabled: false }],
                    bodyRows: [{ key: "", value: "", enabled: true }],
                    authType: "none",
                    authConfig: {
                        bearer: { token: "" },
                        basic: { username: "", password: "" },
                        api_key: { key: "", value: "", add_to: "header" }
                    }
                };

                // Extract auth from HTTPie headers
                const authHeader = (req.headers || []).find(h => h.name?.toLowerCase() === "authorization");
                if (authHeader && authHeader.value) {
                    const authValue = authHeader.value;
                    if (authValue.toLowerCase().startsWith("bearer ")) {
                        parsedReq.authType = "bearer";
                        parsedReq.authConfig.bearer.token = authValue.substring(7);
                        // Remove the auth header from headersRows since it's now in authConfig
                        parsedReq.headersRows = parsedReq.headersRows.filter(
                            h => h.key?.toLowerCase() !== "authorization"
                        );
                    } else if (authValue.toLowerCase().startsWith("basic ")) {
                        try {
                            const decoded = atob(authValue.substring(6));
                            const [username, ...rest] = decoded.split(":");
                            parsedReq.authType = "basic";
                            parsedReq.authConfig.basic = { username, password: rest.join(":") };
                            parsedReq.headersRows = parsedReq.headersRows.filter(
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
                    parsedReq.bodyRows = req.body.form.fields.map(f => ({ key: f.name, value: f.value, enabled: true }));
                }

                if (parsedReq.headersRows.length === 0) parsedReq.headersRows = [{ key: "", value: "", enabled: true }];
                if (parsedReq.paramsRows.length === 0) parsedReq.paramsRows = [{ key: "", value: "", enabled: true }];

                currentItems.push(parsedReq);
            });
        } else if (imported.info && imported.info.schema && imported.info.schema.includes("postman.com/json/collection/v2.1.0")) {
            const colId = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            collection = {
                id: colId,
                name: imported.info.name || "Postman Import",
                items: []
            };

            const parsePostmanItem = (pmItem) => {
                if (pmItem.item) {
                    return {
                        type: "folder",
                        id: `fld-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        name: pmItem.name || "Imported Folder",
                        items: pmItem.item.map(parsePostmanItem).filter(Boolean)
                    };
                } else if (pmItem.request) {
                    const pmReq = pmItem.request;
                    const parsedReq = {
                        type: "request",
                        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        name: pmItem.name || "Imported Request",
                        method: pmReq.method || "GET",
                        url: typeof pmReq.url === 'string' ? pmReq.url : (pmReq.url?.raw || ""),
                        headersRows: (pmReq.header || []).map(h => ({ key: h.key, value: h.value, enabled: true })),
                        paramsRows: (pmReq.url?.query || []).map(q => ({ key: q.key, value: q.value, enabled: true })),
                        authRows: [{ key: "", value: "", enabled: false }],
                        bodyRows: [{ key: "", value: "", enabled: true }],
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
                            const tokenEntry = (pmAuth.bearer || []).find(e => e.key === "token");
                            parsedReq.authType = "bearer";
                            parsedReq.authConfig = {
                                ...parsedReq.authConfig,
                                bearer: { token: tokenEntry?.value || "" }
                            };
                        } else if (authType === "basic") {
                            const userEntry = (pmAuth.basic || []).find(e => e.key === "username");
                            const passEntry = (pmAuth.basic || []).find(e => e.key === "password");
                            parsedReq.authType = "basic";
                            parsedReq.authConfig = {
                                ...parsedReq.authConfig,
                                basic: { username: userEntry?.value || "", password: passEntry?.value || "" }
                            };
                        } else if (authType === "apikey") {
                            const keyEntry = (pmAuth.apikey || []).find(e => e.key === "key");
                            const valEntry = (pmAuth.apikey || []).find(e => e.key === "value");
                            const inEntry = (pmAuth.apikey || []).find(e => e.key === "in");
                            parsedReq.authType = "api_key";
                            parsedReq.authConfig = {
                                ...parsedReq.authConfig,
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
                            parsedReq.bodyRows = (pmReq.body.urlencoded || []).map(p => ({ key: p.key, value: p.value, enabled: true }));
                        } else if (mode === 'formdata') {
                            parsedReq.bodyType = "multipart";
                            parsedReq.bodyRows = (pmReq.body.formdata || []).map(p => ({ key: p.key, value: p.value, enabled: true }));
                        }
                    }

                    if (parsedReq.headersRows.length === 0) parsedReq.headersRows = [{ key: "", value: "", enabled: true }];
                    if (parsedReq.paramsRows.length === 0) parsedReq.paramsRows = [{ key: "", value: "", enabled: true }];

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
