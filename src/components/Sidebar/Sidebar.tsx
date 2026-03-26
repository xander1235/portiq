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
import { ProtocolPicker, PROTOCOLS } from "../ProtocolPicker";

interface RequestItem {
    id: string;
    type: "request";
    name: string;
    protocol?: string;
    method?: string;
    url?: string;
    description?: string;
    tags?: string[];
}

interface FolderItem {
    id: string;
    type: "folder";
    name: string;
    items?: (RequestItem | FolderItem)[];
}

interface Collection {
    id: string;
    name: string;
    items?: (RequestItem | FolderItem)[];
}

interface HistoryItem {
    timestamp: number | string;
    request?: {
        method?: string;
        url?: string;
    };
    response?: {
        status?: number;
        statusText?: string;
        time?: number;
    };
}

interface SidebarProps {
    activeSidebar: string;
    topSearch: string;
    history: HistoryItem[];
    setShowCollectionModal: (show: boolean) => void;
    setShowImportMenu: (show: boolean) => void;
    showImportMenu: boolean;
    importCollection: () => void;
    setShowImportTextModal: (show: boolean) => void;
    setShowImportApiModal: (show: boolean) => void;
    setShowImportCurlModal: (show: boolean) => void;
    collections: Collection[];
    activeCollectionId: string;
    setActiveCollectionId: (id: string) => void;
    addCollection: () => void;
    getActiveCollection: () => Collection | null;
    updateCollectionName: (name: string) => void;
    addFolderToCollection: (parentId?: string) => void;
    addRequestToCollection: (parentId: string | null, callback?: (req: any) => void) => any;
    updateRequestState: (id: string, key: string, val: any) => void;
    duplicateCollection: (id: string) => void;
    exportCollection: (id: string) => void;
    moveItemInCollection: (sourceId: string, targetId: string | null, isFolder: boolean) => void;
    updateFolderName: (id: string, name: string) => void;
    deleteFolder: (id: string) => void;
    duplicateItem: (id: string) => void;
    deleteRequest: (id: string) => void;
    updateRequestName: (id: string, name: string) => void;
    loadRequest: (req: any) => void;
    setItemToMove: (item: any) => void;
    setMoveTargetId: (id: string) => void;
    setShowMoveModal: (show: boolean) => void;
    loadHistoryItem: (item: HistoryItem) => void;
    activeRequestId?: string;
}

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
    loadHistoryItem,
    activeRequestId
}: SidebarProps) {
    const [editingCollectionName, setEditingCollectionName] = useState(false);
    const [collectionNameDraft, setCollectionNameDraft] = useState("");
    const [showCollectionMenu, setShowCollectionMenu] = useState(false);
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
    const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
    const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem("vaaya_collapsedFolders");
            return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
        } catch (e) {
            return new Set<string>();
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

    useEffect(() => {
        const handleGlobalClick = () => {
            setOpenFolderMenuId("");
        };
        document.addEventListener("mousedown", handleGlobalClick);
        return () => document.removeEventListener("mousedown", handleGlobalClick);
    }, []);
    const [collapsedHistoryDates, setCollapsedHistoryDates] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem("vaaya_collapsedHistoryDates");
            return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
        } catch (e) {
            return new Set<string>();
        }
    });

    useEffect(() => {
        localStorage.setItem("vaaya_collapsedHistoryDates", JSON.stringify(Array.from(collapsedHistoryDates)));
    }, [collapsedHistoryDates]);
    const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);
    const [protocolPickerTarget, setProtocolPickerTarget] = useState<{ folderId: string | null } | null>(null); // { folderId } or "root" when creating request
    const [changeProtocolRequestId, setChangeProtocolRequestId] = useState<string>(""); // request id when changing protocol via ⋮ menu

    function matchesQuery(item: RequestItem | FolderItem, q: string): boolean {
        if (!q) return true;
        const query = q.toLowerCase();
        if (item.type === "folder") {
            if (item.name.toLowerCase().includes(query)) return true;
            if (item.items && item.items.some(child => matchesQuery(child, query))) return true;
        } else if (item.type === "request") {
            const tagMatch = Array.isArray(item.tags) && item.tags.some(tag => tag.toLowerCase().includes(query));
            return (
                item.name.toLowerCase().includes(query) ||
                item.url?.toLowerCase().includes(query) ||
                item.method?.toLowerCase().includes(query) ||
                item.description?.toLowerCase().includes(query) ||
                (tagMatch ?? false)
            );
        }
        return false;
    }

    function renderCollectionItems(items: (RequestItem | FolderItem)[], depth = 0) {
        if (!Array.isArray(items)) return null;
        const filtered = items.filter((item) => matchesQuery(item, topSearch));

        const folders = filtered.filter((item): item is FolderItem => item.type === "folder");
        const requests = filtered.filter((item): item is RequestItem => item.type === "request");

        return (
            <div className={styles.treeNode}>
                {folders.map((item) => {
                    const isOpen = !collapsedFolders.has(item.id);
                    return (
                        <div key={item.id} className={styles.folderWrapper}>
                            <div
                                className={`${styles.treeFolder} ${dragOverItemId === item.id ? styles.dragOver : ""}`}
                                onClick={() => {
                                    setCollapsedFolders(prev => {
                                        const next = new Set(prev);
                                        if (next.has(item.id)) next.delete(item.id);
                                        else next.add(item.id);
                                        return next;
                                    });
                                }}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setOpenFolderMenuId(item.id);
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDragOverItemId(item.id);
                                }}
                                onDragLeave={() => setDragOverItemId(null)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDragOverItemId(null);
                                    if (draggedItemId && draggedItemId !== item.id) {
                                        moveItemInCollection(draggedItemId, item.id, true);
                                    }
                                }}
                            >
                                <span className={`${styles.folderIcon} ${isOpen ? styles.open : ""}`}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                </span>
                                <span className={styles.folderLabelIcon}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                </span>
                                {editingFolderId === item.id ? (
                                    <input
                                        autoFocus
                                        className={styles.editInput}
                                        value={folderNameDraft}
                                        onChange={(e) => setFolderNameDraft(e.target.value)}
                                        onBlur={() => {
                                            if (folderNameDraft.trim()) updateFolderName(item.id, folderNameDraft.trim());
                                            setEditingFolderId("");
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                if (folderNameDraft.trim()) updateFolderName(item.id, folderNameDraft.trim());
                                                setEditingFolderId("");
                                            } else if (e.key === "Escape") {
                                                setEditingFolderId("");
                                            }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span 
                                        className={styles.itemName}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setFolderNameDraft(item.name);
                                            setEditingFolderId(item.id);
                                        }}
                                    >
                                        {item.name}
                                    </span>
                                )}

                                <div className={styles.itemActions}>
                                    <button className={styles.itemActionBtn} onClick={(e) => {
                                        e.stopPropagation();
                                        setProtocolPickerTarget({ folderId: item.id });
                                    }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </button>
                                    <button className={styles.itemActionBtn} onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenFolderMenuId(prev => prev === item.id ? "" : item.id);
                                    }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                                    </button>
                                </div>

                                {openFolderMenuId === item.id && (
                                    <div className={styles.itemMenu} onClick={e => e.stopPropagation()}>
                                        <button onClick={() => { 
                                            setFolderNameDraft(item.name);
                                            setEditingFolderId(item.id);
                                            setOpenFolderMenuId(""); 
                                        }}>Rename</button>
                                        <button onClick={() => { addFolderToCollection(item.id); setOpenFolderMenuId(""); }}>New Folder</button>
                                        <button onClick={() => { duplicateItem(item.id); setOpenFolderMenuId(""); }}>Duplicate</button>
                                        <button className={styles.delete} onClick={() => { if (confirm("Delete folder and all its items?")) deleteFolder(item.id); setOpenFolderMenuId(""); }}>Delete</button>
                                    </div>
                                )}
                            </div>
                            {isOpen && (
                                <div className={styles.treeChildren}>
                                    {renderCollectionItems(item.items || [], depth + 1)}
                                </div>
                            )}
                        </div>
                    );
                })}
                {requests.map((item) => (
                    <div
                        className={`${styles.treeRequest} ${activeRequestId === item.id ? styles.active : ""} ${dragOverItemId === item.id ? styles.dragOver : ""}`}
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
                            setDragOverItemId(item.id);
                        }}
                        onDragLeave={() => setDragOverItemId(null)}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverItemId(null);
                            const sourceId = e.dataTransfer.getData("text/plain");
                            if (sourceId && sourceId !== item.id) {
                                moveItemInCollection(sourceId, item.id, false);
                            }
                        }}
                        onClick={() => loadRequest(item)}
                    >
                        <div className={styles.treeRequestHeader}>
                            {item.protocol && item.protocol !== "http" ? (
                                <span className={`${styles.protocolBadge} ${styles[item.protocol] || ""}`}>
                                    {(item.protocol as any) === "graphql" ? "GQL" :
                                     (item.protocol as any) === "websocket" ? "WS" :
                                     (item.protocol as any) === "grpc" ? "gRPC" :
                                     (item.protocol as any) === "sse" ? "SSE" :
                                     (item.protocol as any) === "mcp" ? "MCP" :
                                     (item.protocol as any) === "dag" ? "DAG" :
                                     item.protocol.toUpperCase()}
                                </span>
                            ) : (
                                <span className={`${styles.methodBadge} ${item.method ? styles[item.method.toLowerCase()] : ""}`}>{item.method}</span>
                            )}
                                {editingRequestId === item.id ? (
                                    <input
                                        autoFocus
                                        className={styles.editInput}
                                        value={requestNameDraft}
                                        onChange={(e) => setRequestNameDraft(e.target.value)}
                                        onBlur={() => {
                                            if (requestNameDraft.trim()) updateRequestName(item.id, requestNameDraft.trim());
                                            setEditingRequestId("");
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                if (requestNameDraft.trim()) updateRequestName(item.id, requestNameDraft.trim());
                                                setEditingRequestId("");
                                            } else if (e.key === "Escape") {
                                                setEditingRequestId("");
                                            }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span 
                                        className={styles.itemName}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setRequestNameDraft(item.name);
                                            setEditingRequestId(item.id);
                                        }}
                                    >
                                        {item.name}
                                    </span>
                                )}

                                <div className={styles.itemActions}>
                                    <button className={styles.itemActionBtn} onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenFolderMenuId(prev => prev === item.id ? "" : item.id); // Toggle logic
                                    }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                                    </button>
                                </div>

                                {openFolderMenuId === item.id && (
                                    <div className={styles.itemMenu} onClick={e => e.stopPropagation()}>
                                        <button onClick={() => { 
                                            setRequestNameDraft(item.name);
                                            setEditingRequestId(item.id);
                                            setOpenFolderMenuId(""); 
                                        }}>Rename</button>
                                    <button onClick={() => { duplicateItem(item.id); setOpenFolderMenuId(""); }}>Duplicate</button>
                                    <button onClick={() => { setChangeProtocolRequestId(item.id); setOpenFolderMenuId(""); }}>Change Protocol</button>
                                    <button className={styles.delete} onClick={() => { if (confirm("Delete request?")) deleteRequest(item.id); setOpenFolderMenuId(""); }}>Delete</button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );
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
                    <div className={styles.panelBody}>
                        <div className={styles.collectionSection}>
                            <div className={styles.panelRow}>
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
                        <div className={styles.collectionSection} style={{ flex: 1, minHeight: 0, overflow: 'hidden', paddingBottom: 0, marginBottom: 0, borderBottom: 'none' }}>
                            <div className={styles.panelRow}>
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
                    <div className={styles.panelBody} style={{ overflowY: "auto", overflowX: "hidden" }}>
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
                            const groupedHistory: Record<string, HistoryItem[]> = {};
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
                                            <div className={`${styles.caret} ${isCollapsed ? '' : styles.open}`}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                            </div>
                                            <div className={styles.historyGroupTitle}>
                                                {dateStr}
                                            </div>
                                            <div className={styles.historyGroupCount}>
                                                {items.length} req
                                            </div>
                                        </div>

                                        {!isCollapsed && items.map((item: HistoryItem, idx: number) => (
                                            <div
                                                key={idx}
                                                className={styles.historyItem}
                                                onClick={() => {
                                                    loadHistoryItem(item);
                                                }}
                                            >
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                                    <span className={`${styles.methodBadge} ${styles[(item.request?.method || "GET").toLowerCase()] || ''}`} style={{ opacity: 0.9 }}>
                                                        {item.request?.method || "GET"}
                                                    </span>
                                                    <span style={{ color: "var(--muted)", fontSize: "0.7rem", fontWeight: 500 }}>
                                                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                                                        background: (item.response?.status ?? 0) >= 200 && (item.response?.status ?? 0) < 300 ? "rgba(46, 211, 198, 0.1)" : "rgba(255, 85, 85, 0.1)",
                                                        color: (item.response?.status ?? 0) >= 200 && (item.response?.status ?? 0) < 300 ? "var(--accent-2)" : "#ff5555",
                                                        fontWeight: 600,
                                                        border: (item.response?.status ?? 0) >= 200 && (item.response?.status ?? 0) < 300 ? "1px solid rgba(46, 211, 198, 0.2)" : "1px solid rgba(255, 85, 85, 0.2)"
                                                    }}>
                                                        {item.response?.status} {item.response?.statusText}
                                                    </span>
                                                    <span style={{ fontSize: "0.65rem", color: "var(--muted)", fontWeight: 500 }}>
                                                        {item.response?.time ? `${item.response.time} ms` : ""}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
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
                        currentProtocol=""
                        onSelect={(proto: any) => {
                            const folderId = protocolPickerTarget?.folderId;
                            const PROTO_DEFAULTS: Record<string, any> = {
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
                        currentProtocol=""
                        onSelect={(proto: any) => {
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
