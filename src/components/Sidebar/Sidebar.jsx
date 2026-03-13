import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import styles from "./Sidebar.module.css";
import { ProtocolPicker, PROTOCOLS } from "../ProtocolPicker.jsx";

export function Sidebar({
    activeSidebar,
    topSearch,
    history,
    setShowCollectionModal,
    setShowImportMenu,
    showImportMenu,
    importCollection,
    setShowImportTextModal,
    setShowImportApiModal,
    setShowImportCurlModal,
    collections,
    activeCollectionId,
    setActiveCollectionId,
    addCollection,
    getActiveCollection,
    updateCollectionName,
    addFolderToCollection,
    addRequestToCollection,
    updateRequestState,
    duplicateCollection,
    exportCollection,
    moveItemInCollection,
    updateFolderName,
    deleteFolder,
    duplicateItem,
    deleteRequest,
    updateRequestName,
    loadRequest,
    setItemToMove,
    setMoveTargetId,
    setShowMoveModal,
    loadHistoryItem
}) {
    const [editingCollectionName, setEditingCollectionName] = useState(false);
    const [collectionNameDraft, setCollectionNameDraft] = useState("");
    const [showCollectionMenu, setShowCollectionMenu] = useState(false);
    const [draggedItemId, setDraggedItemId] = useState(null);
    const [dragOverItemId, setDragOverItemId] = useState(null);
    const [collapsedFolders, setCollapsedFolders] = useState(() => {
        try {
            const saved = localStorage.getItem("vaaya_collapsedFolders");
            return saved ? new Set(JSON.parse(saved)) : new Set();
        } catch (e) {
            return new Set();
        }
    });

    useEffect(() => {
        localStorage.setItem("vaaya_collapsedFolders", JSON.stringify(Array.from(collapsedFolders)));
    }, [collapsedFolders]);

    const [editingFolderId, setEditingFolderId] = useState("");
    const [folderNameDraft, setFolderNameDraft] = useState("");
    const [openFolderMenuId, setOpenFolderMenuId] = useState("");
    const [editingRequestId, setEditingRequestId] = useState("");
    const [requestNameDraft, setRequestNameDraft] = useState("");
    const [collapsedHistoryDates, setCollapsedHistoryDates] = useState(() => {
        try {
            const saved = localStorage.getItem("vaaya_collapsedHistoryDates");
            return saved ? new Set(JSON.parse(saved)) : new Set();
        } catch (e) {
            return new Set();
        }
    });

    useEffect(() => {
        localStorage.setItem("vaaya_collapsedHistoryDates", JSON.stringify(Array.from(collapsedHistoryDates)));
    }, [collapsedHistoryDates]);
    const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);
    const [protocolPickerTarget, setProtocolPickerTarget] = useState(null); // { folderId } or "root" when creating request
    const [changeProtocolRequestId, setChangeProtocolRequestId] = useState(""); // request id when changing protocol via ⋮ menu

    function matchesQuery(item, q) {
        if (!q) return true;
        q = q.toLowerCase();
        if (item.type === "folder") {
            if (item.name.toLowerCase().includes(q)) return true;
            if (item.items && item.items.some(child => matchesQuery(child, q))) return true;
        } else if (item.type === "request") {
            const tagMatch = Array.isArray(item.tags) && item.tags.some(tag => tag.toLowerCase().includes(q));
            return (
                item.name.toLowerCase().includes(q) ||
                item.url?.toLowerCase().includes(q) ||
                item.method?.toLowerCase().includes(q) ||
                item.description?.toLowerCase().includes(q) ||
                tagMatch
            );
        }
        return false;
    }

    function renderCollectionItems(items, depth = 0) {
        if (!Array.isArray(items)) return null;
        const filtered = items.filter((item) => matchesQuery(item, topSearch));
        const folders = filtered.filter((item) => item.type === "folder");
        const requests = filtered.filter((item) => item.type === "request");
        return [
            ...folders.map((item) => {
                if (item.type === "folder") {
                    return (
                        <div
                            className={styles.treeNode}
                            key={item.id}
                            draggable
                            onDragStart={(e) => {
                                e.stopPropagation();
                                setDraggedItemId(item.id);
                                e.dataTransfer.setData("text/plain", item.id);
                                if (!collapsedFolders.has(item.id)) {
                                    setCollapsedFolders(prev => new Set(prev).add(item.id));
                                }
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItemId !== item.id && dragOverItemId !== item.id) {
                                    setDragOverItemId(item.id);
                                }
                            }}
                            onDragLeave={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (dragOverItemId === item.id) setDragOverItemId(null);
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverItemId(null);
                                setDraggedItemId(null);
                                const sourceId = e.dataTransfer.getData("text/plain");
                                if (sourceId) moveItemInCollection(sourceId, item.id, true);
                            }}
                            onDragEnd={() => {
                                setDraggedItemId(null);
                                setDragOverItemId(null);
                            }}
                        >
                            <div className={`${styles.treeFolder} ${dragOverItemId === item.id ? styles.dragOver : ''} ${draggedItemId === item.id ? styles.dragging : ''}`}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
                                    <button
                                        className="ghost icon-button icon-plain"
                                        style={{ padding: '0 4px', fontSize: '0.65rem', color: 'var(--muted)', width: '20px' }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setCollapsedFolders(prev => {
                                                const next = new Set(prev);
                                                if (next.has(item.id)) next.delete(item.id);
                                                else next.add(item.id);
                                                return next;
                                            });
                                        }}
                                    >
                                        {collapsedFolders.has(item.id) ? '▶' : '▼'}
                                    </button>
                                    {editingFolderId === item.id ? (
                                        <input
                                            autoFocus
                                            className="input compact"
                                            value={folderNameDraft}
                                            onChange={(e) => setFolderNameDraft(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
                                                    updateFolderName(item.id, folderNameDraft.trim() || item.name);
                                                    setEditingFolderId("");
                                                    setFolderNameDraft("");
                                                }
                                            }}
                                            onBlur={() => {
                                                updateFolderName(item.id, folderNameDraft.trim() || item.name);
                                                setEditingFolderId("");
                                                setFolderNameDraft("");
                                            }}
                                        />
                                    ) : (
                                        <button
                                            className={styles.folderName}
                                            onDoubleClick={() => {
                                                setEditingFolderId(item.id);
                                                setFolderNameDraft(item.name);
                                            }}
                                        >
                                            {item.name}
                                        </button>
                                    )}
                                </div>
                                <div className={styles.menuWrap}>
                                    <DropdownMenu open={openFolderMenuId === item.id} onOpenChange={(open) => setOpenFolderMenuId(open ? item.id : "")}>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground" onClick={(e) => e.stopPropagation()}>⋮</Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-40 bg-panel border-border text-foreground" onClick={(e) => e.stopPropagation()}>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingFolderId(item.id); setFolderNameDraft(item.name); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Rename</DropdownMenuItem>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateItem(item.id); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Duplicate</DropdownMenuItem>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setItemToMove(item); setMoveTargetId("root"); setShowMoveModal(true); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Move</DropdownMenuItem>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); deleteFolder(item.id); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs text-red-500 focus:bg-red-500/10 focus:text-red-500">Delete</DropdownMenuItem>
                                            <DropdownMenuSeparator className="bg-border" />
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); exportCollection(item.id); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Export</DropdownMenuItem>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); addFolderToCollection(item.id); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Create Folder</DropdownMenuItem>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setProtocolPickerTarget({ folderId: item.id }); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Create Request</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                            {!collapsedFolders.has(item.id) && (
                                <div className={styles.treeChildren}>{renderCollectionItems(item.items, depth + 1)}</div>
                            )}
                        </div>
                    );
                }
                return null;
            }),
            ...(requests.length
                ? requests.map((item) => (
                    <div
                        className={styles.treeNode}
                        key={item.id}
                        draggable
                        onDragStart={(e) => {
                            e.stopPropagation();
                            setDraggedItemId(item.id);
                            e.dataTransfer.setData("text/plain", item.id);
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (draggedItemId !== item.id && dragOverItemId !== item.id) {
                                setDragOverItemId(item.id);
                            }
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (dragOverItemId === item.id) setDragOverItemId(null);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverItemId(null);
                            setDraggedItemId(null);
                            const sourceId = e.dataTransfer.getData("text/plain");
                            if (sourceId) moveItemInCollection(sourceId, item.id, false);
                        }}
                        onDragEnd={() => {
                            setDraggedItemId(null);
                            setDragOverItemId(null);
                        }}
                    >
                        <div className={`${styles.treeRequest} ${dragOverItemId === item.id ? styles.dragOver : ''} ${draggedItemId === item.id ? styles.dragging : ''}`} onClick={() => loadRequest(item)}>
                            <div className={styles.treeRequestHeader}>
                                {item.protocol && item.protocol !== "http" ? (
                                    <span
                                        className={`${styles.protocolBadge} ${styles[item.protocol] || ""}`}
                                    >
                                        {{ graphql: "GQL", websocket: "WS", grpc: "gRPC", sse: "SSE", mcp: "MCP", dag: "DAG" }[item.protocol] || item.protocol.toUpperCase()}
                                    </span>
                                ) : (
                                    <span className={`${styles.methodBadge} ${item.method ? styles[item.method.toLowerCase()] : ''}`}>{item.method}</span>
                                )}
                                {editingRequestId === item.id ? (
                                    <input
                                        autoFocus
                                        className="input compact"
                                        value={requestNameDraft}
                                        onChange={(e) => setRequestNameDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
                                                updateRequestName(item.id, requestNameDraft.trim() || item.name);
                                                setEditingRequestId("");
                                                setRequestNameDraft("");
                                            }
                                        }}
                                        onBlur={() => {
                                            updateRequestName(item.id, requestNameDraft.trim() || item.name);
                                            setEditingRequestId("");
                                            setRequestNameDraft("");
                                        }}
                                    />
                                ) : (
                                    <button
                                        className={styles.treeTitle}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setEditingRequestId(item.id);
                                            setRequestNameDraft(item.name);
                                        }}
                                    >
                                        {item.name}
                                    </button>
                                )}
                                <div className={styles.menuWrap}>
                                    <DropdownMenu open={openFolderMenuId === item.id} onOpenChange={(open) => setOpenFolderMenuId(open ? item.id : "")}>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground" onClick={(e) => e.stopPropagation()}>⋮</Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-40 bg-panel border-border text-foreground" onClick={(e) => e.stopPropagation()}>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingRequestId(item.id); setRequestNameDraft(item.name); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Rename</DropdownMenuItem>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateItem(item.id); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Duplicate</DropdownMenuItem>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setItemToMove(item); setMoveTargetId("root"); setShowMoveModal(true); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Move</DropdownMenuItem>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); deleteRequest(item.id); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs text-red-500 focus:bg-red-500/10 focus:text-red-500">Delete</DropdownMenuItem>
                                            <DropdownMenuSeparator className="bg-border" />
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setChangeProtocolRequestId(item.id); setOpenFolderMenuId(""); }} className="cursor-pointer text-xs">Change Protocol</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                            {item.description && <div className={styles.treeDesc}>{item.description}</div>}
                            {Array.isArray(item.tags) && item.tags.length > 0 && (
                                <div className={styles.treeTags}>
                                    {item.tags.map((tag) => (
                                        <span className={styles.tag} key={`${item.id}-${tag}`}>{tag}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))
                : [])
        ];
    }

    return (
        <aside className={styles.sidebar}>
            <div className={styles.sidebarPanel}>
                <div className={`${styles.panelTitle} ${styles.headerRow} flex items-center justify-between`}>
                    <span className="font-semibold">{activeSidebar}</span>
                    {activeSidebar === "Collections" && (
                        <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => setShowCollectionModal(true)}>Manage</Button>
                            <DropdownMenu open={showImportMenu} onOpenChange={setShowImportMenu}>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2">Import</Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="menu w-40 bg-panel border-border text-foreground">
                                    <DropdownMenuItem
                                        onSelect={() => {
                                            setTimeout(() => importCollection(), 0);
                                        }}
                                        className="cursor-pointer text-xs"
                                    >
                                        From File
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() => {
                                            setTimeout(() => setShowImportTextModal(true), 0);
                                        }}
                                        className="cursor-pointer text-xs"
                                    >
                                        From Text
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() => {
                                            setTimeout(() => setShowImportCurlModal(true), 0);
                                        }}
                                        className="cursor-pointer text-xs"
                                    >
                                        From cURL
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() => {
                                            setTimeout(() => setShowImportApiModal(true), 0);
                                        }}
                                        className="cursor-pointer text-xs"
                                    >
                                        From API URL
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )}
                </div>
                {activeSidebar === "Collections" && (
                    <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                        <div className={styles.collectionSection}>
                            <div className="panel-row flex items-center gap-2">
                                <DropdownMenu open={showCollectionDropdown} onOpenChange={setShowCollectionDropdown}>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="flex-1 justify-between h-9 bg-panel border-border shadow-sm">
                                            <div className="flex items-center gap-2 truncate">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--accent-2)' }}>
                                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                                </svg>
                                                <span className="truncate text-[13px] font-medium">
                                                    {collections.find(c => c.id === activeCollectionId)?.name || "Select Collection"}
                                                </span>
                                            </div>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
                                                <polyline points="6 9 12 15 18 9"></polyline>
                                            </svg>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-[300px] bg-panel border-border p-2">
                                        <DropdownMenuLabel className="text-[11px] font-semibold uppercase text-muted-foreground">Your Collections</DropdownMenuLabel>
                                        {collections.map((col) => {
                                            const isActive = col.id === activeCollectionId;
                                            return (
                                                <DropdownMenuItem
                                                    key={col.id}
                                                    onClick={() => {
                                                        setActiveCollectionId(col.id);
                                                        setShowCollectionDropdown(false);
                                                    }}
                                                    className={`flex items-center gap-2 cursor-pointer ${isActive ? 'bg-accent-2/10 text-accent-2' : ''}`}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill={isActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={isActive ? "0" : "2"} strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                                                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                                    </svg>
                                                    <span className="truncate">{col.name}</span>
                                                    {isActive && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="ml-auto"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                                                </DropdownMenuItem>
                                            );
                                        })}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-9 w-9 shrink-0 bg-panel border-border text-xl"
                                    onClick={addCollection}
                                    title="Create Collection"
                                >
                                    +
                                </Button>
                            </div>
                        </div>
                        <div className={styles.collectionSection} style={{ flex: 1, minHeight: 0, paddingBottom: 0, marginBottom: 0, borderBottom: 'none' }}>
                            <div className="panel-row">
                                {editingCollectionName ? (
                                    <input
                                        autoFocus
                                        className="input"
                                        placeholder="Collection name"
                                        value={collectionNameDraft}
                                        onChange={(e) => setCollectionNameDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || (e.ctrlKey && e.key.toLowerCase() === "s")) {
                                                updateCollectionName(collectionNameDraft.trim() || getActiveCollection()?.name || "");
                                                setEditingCollectionName(false);
                                            }
                                        }}
                                        onBlur={() => {
                                            updateCollectionName(collectionNameDraft.trim() || getActiveCollection()?.name || "");
                                            setEditingCollectionName(false);
                                        }}
                                    />
                                ) : (
                                    <button
                                        className={styles.folderName}
                                        onDoubleClick={() => {
                                            setEditingCollectionName(true);
                                            setCollectionNameDraft(getActiveCollection()?.name || "");
                                        }}
                                    >
                                        {getActiveCollection()?.name || "Untitled Collection"}
                                    </button>
                                )}
                                <div className={styles.menuWrap} style={{ marginLeft: 'auto' }}>
                                    <DropdownMenu open={showCollectionMenu} onOpenChange={setShowCollectionMenu}>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground mr-2">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48 bg-panel border-border text-foreground">
                                            <DropdownMenuItem onClick={() => { addFolderToCollection(); setShowCollectionMenu(false); }} className="cursor-pointer text-xs">Create Folder</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => { setProtocolPickerTarget({ folderId: null }); setShowCollectionMenu(false); }} className="cursor-pointer text-xs">Create Request</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => { duplicateCollection(activeCollectionId); setShowCollectionMenu(false); }} className="cursor-pointer text-xs">Duplicate Collection</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => { exportCollection(activeCollectionId); setShowCollectionMenu(false); }} className="cursor-pointer text-xs">Export Collection</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                            <div
                                className={`${styles.panelList} ${dragOverItemId === 'root' ? styles.dragOver : ''}`}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (draggedItemId && dragOverItemId !== 'root') {
                                        setDragOverItemId('root');
                                    }
                                }}
                                onDragLeave={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    // Only clear if we are leaving the panel-list itself, not when entering children
                                    if (e.currentTarget === e.target) {
                                        if (dragOverItemId === 'root') setDragOverItemId(null);
                                    }
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDragOverItemId(null);
                                    setDraggedItemId(null);
                                    const sourceId = e.dataTransfer.getData("text/plain");
                                    if (sourceId) moveItemInCollection(sourceId, null, true);
                                }}
                                style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '20px' }}
                            >
                                {renderCollectionItems(getActiveCollection()?.items || [])}
                            </div>
                        </div>
                    </div>
                )}
                {activeSidebar === "Environments" && (
                    <div className="panel-body">
                        Click Environments to manage variables.
                    </div>
                )}
                {activeSidebar === "History" && (
                    <div className="history-list" style={{ display: "flex", flexDirection: "column", flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                        {(() => {
                            if (!Array.isArray(history) || history.length === 0) {
                                return (
                                    <div className="empty-state">
                                        <div className="empty-state-icon">
                                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                        </div>
                                        <div>No request history</div>
                                        <div style={{ fontSize: "0.85rem", marginTop: "8px" }}>Your sent requests will appear here.</div>
                                    </div>
                                );
                            }

                            // Group history by date
                            const groupedHistory = {};
                            history.slice().reverse().forEach(item => {
                                const d = new Date(item.timestamp);
                                const dateStr = d.toLocaleDateString();
                                if (!groupedHistory[dateStr]) groupedHistory[dateStr] = [];
                                groupedHistory[dateStr].push(item);
                            });

                            return Object.keys(groupedHistory).map(dateStr => {
                                const isCollapsed = collapsedHistoryDates.has(dateStr);
                                const items = groupedHistory[dateStr];

                                return (
                                    <div key={dateStr} style={{ display: 'flex', flexDirection: 'column' }}>
                                        <div
                                            onClick={() => {
                                                const newCollapsed = new Set(collapsedHistoryDates);
                                                if (isCollapsed) newCollapsed.delete(dateStr);
                                                else newCollapsed.add(dateStr);
                                                setCollapsedHistoryDates(newCollapsed);
                                            }}
                                            style={{
                                                padding: '6px 12px',
                                                background: 'var(--panel-1)',
                                                borderBottom: '1px solid var(--border)',
                                                borderTop: '1px solid var(--border)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                cursor: 'pointer',
                                                position: 'sticky',
                                                top: 0,
                                                zIndex: 10
                                            }}
                                        >
                                            <div className={`caret ${isCollapsed ? '' : 'open'}`}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                            </div>
                                            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>
                                                {dateStr}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: 'auto' }}>
                                                {items.length} req
                                            </div>
                                        </div>

                                        {!isCollapsed && items.map((item, idx) => {
                                            const d = new Date(item.timestamp);
                                            const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                            const method = item.request?.method || "GET";
                                            const methodColorClass = method.toLowerCase();
                                            const isLast = idx === items.length - 1;

                                            return (
                                                <div key={idx} style={{
                                                    margin: "0 10px 8px 10px",
                                                    padding: "10px",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: "8px",
                                                    cursor: "pointer",
                                                    background: "var(--panel-2)",
                                                    border: "1px solid var(--border)",
                                                    borderRadius: "8px",
                                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                                                    transition: "all 0.15s ease",
                                                }} onClick={() => {
                                                    loadHistoryItem(item);
                                                }}
                                                    onMouseOver={(e) => {
                                                        e.currentTarget.style.background = "var(--panel-3)";
                                                        e.currentTarget.style.borderColor = "var(--accent-2)";
                                                        e.currentTarget.style.transform = "translateY(-1px)";
                                                        e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.15)";
                                                    }}
                                                    onMouseOut={(e) => {
                                                        e.currentTarget.style.background = "var(--panel-2)";
                                                        e.currentTarget.style.borderColor = "var(--border)";
                                                        e.currentTarget.style.transform = "translateY(0)";
                                                        e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
                                                    }}
                                                >
                                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                                        <span className={`${styles.methodBadge} ${styles[methodColorClass] || ''}`} style={{ opacity: 0.9 }}>
                                                            {method}
                                                        </span>
                                                        <span style={{ color: "var(--muted)", fontSize: "0.7rem", fontWeight: 500 }}>
                                                            {timeStr}
                                                        </span>
                                                    </div>

                                                    <div style={{
                                                        fontSize: "0.75rem",
                                                        fontWeight: 500,
                                                        color: "var(--text)",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }} title={item.request?.url}>
                                                        {item.request?.url || "Unknown URL"}
                                                    </div>

                                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                        <span style={{
                                                            fontSize: "0.65rem",
                                                            padding: "1px 5px",
                                                            borderRadius: "4px",
                                                            background: item.response?.status >= 200 && item.response?.status < 300 ? "rgba(46, 211, 198, 0.1)" : "rgba(255, 85, 85, 0.1)",
                                                            color: item.response?.status >= 200 && item.response?.status < 300 ? "var(--accent-2)" : "#ff5555",
                                                            fontWeight: 600,
                                                            border: item.response?.status >= 200 && item.response?.status < 300 ? "1px solid rgba(46, 211, 198, 0.2)" : "1px solid rgba(255, 85, 85, 0.2)"
                                                        }}>
                                                            {item.response?.status} {item.response?.statusText}
                                                        </span>
                                                        <span style={{ fontSize: "0.65rem", color: "var(--muted)", fontWeight: 500 }}>
                                                            {item.response?.time ? `${item.response.time} ms` : ""}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            });
                        })()}
                    </div>
                )}
            </div>

            {/* Protocol picker popup for Create Request */}
            {protocolPickerTarget && (
                <div
                    style={{
                        position: "fixed", inset: 0, zIndex: 9999,
                        background: "rgba(0,0,0,0.35)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        backdropFilter: "blur(2px)",
                    }}
                    onClick={() => setProtocolPickerTarget(null)}
                >
                    <ProtocolPicker
                        onSelect={(proto) => {
                            const folderId = protocolPickerTarget.folderId;
                            const PROTO_DEFAULTS = {
                                graphql: { method: "POST", name: "New GraphQL Request" },
                                websocket: { method: "GET", name: "New WebSocket Connection", url: "ws://localhost:8080" },
                                grpc: { method: "POST", name: "New gRPC Request" },
                                sse: { method: "GET", name: "New SSE Stream", url: "http://localhost:3000/events" },
                                mcp: { method: "POST", name: "New MCP Request", url: "http://localhost:3000/mcp" },
                                dag: { method: "GET", name: "New DAG Flow" },
                            };
                            const defaults = PROTO_DEFAULTS[proto] || {};
                            const newReq = addRequestToCollection(folderId, (req) => {
                                req.protocol = proto;
                                Object.assign(req, defaults);
                            });
                            if (newReq) loadRequest(newReq);
                            setProtocolPickerTarget(null);
                        }}
                        onClose={() => setProtocolPickerTarget(null)}
                    />
                </div>
            )}

            {/* Protocol picker popup for Change Protocol on existing request */}
            {changeProtocolRequestId && (
                <div
                    style={{
                        position: "fixed", inset: 0, zIndex: 9999,
                        background: "rgba(0,0,0,0.35)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        backdropFilter: "blur(2px)",
                    }}
                    onClick={() => setChangeProtocolRequestId("")}
                >
                    <ProtocolPicker
                        onSelect={(proto) => {
                            updateRequestState(changeProtocolRequestId, "protocol", proto);
                            setChangeProtocolRequestId("");
                        }}
                        onClose={() => setChangeProtocolRequestId("")}
                    />
                </div>
            )}
        </aside >
    );
}
