import React, { useState } from "react";

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
    collections,
    activeCollectionId,
    setActiveCollectionId,
    addCollection,
    getActiveCollection,
    updateCollectionName,
    addFolderToCollection,
    addRequestToCollection,
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
    setShowGitHubSyncModal,
    loadHistoryItem
}) {
    const [editingCollectionName, setEditingCollectionName] = useState(false);
    const [collectionNameDraft, setCollectionNameDraft] = useState("");
    const [showCollectionMenu, setShowCollectionMenu] = useState(false);
    const [draggedItemId, setDraggedItemId] = useState(null);
    const [dragOverItemId, setDragOverItemId] = useState(null);
    const [collapsedFolders, setCollapsedFolders] = useState(new Set());
    const [editingFolderId, setEditingFolderId] = useState("");
    const [folderNameDraft, setFolderNameDraft] = useState("");
    const [openFolderMenuId, setOpenFolderMenuId] = useState("");
    const [editingRequestId, setEditingRequestId] = useState("");
    const [requestNameDraft, setRequestNameDraft] = useState("");
    const [collapsedHistoryDates, setCollapsedHistoryDates] = useState(new Set());

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
                            className="tree-node"
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
                            <div className={`tree-folder ${dragOverItemId === item.id ? 'drag-over' : ''} ${draggedItemId === item.id ? 'dragging' : ''}`}>
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
                                            className="ghost folder-name"
                                            onDoubleClick={() => {
                                                setEditingFolderId(item.id);
                                                setFolderNameDraft(item.name);
                                            }}
                                        >
                                            {item.name}
                                        </button>
                                    )}
                                </div>
                                <div className="menu-wrap">
                                    <button
                                        className="ghost icon-button icon-plain"
                                        onClick={() => setOpenFolderMenuId((prev) => (prev === item.id ? "" : item.id))}
                                        aria-label="Folder options"
                                    >
                                        ⋮
                                    </button>
                                    {openFolderMenuId === item.id && (
                                        <div className="menu">
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    setEditingFolderId(item.id);
                                                    setFolderNameDraft(item.name);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Rename
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    duplicateItem(item.id);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Duplicate
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    setItemToMove(item);
                                                    setMoveTargetId("root");
                                                    setShowMoveModal(true);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Move
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    deleteFolder(item.id);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Delete
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    exportCollection(item.id);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Export
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    addFolderToCollection(item.id);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Create Folder
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    addRequestToCollection(item.id);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Create Request
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            {!collapsedFolders.has(item.id) && (
                                <div className="tree-children">{renderCollectionItems(item.items, depth + 1)}</div>
                            )}
                        </div>
                    );
                }
                return null;
            }),
            ...(requests.length
                ? requests.map((item) => (
                    <div
                        className="tree-node"
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
                        <div className={`tree-request ${dragOverItemId === item.id ? 'drag-over' : ''} ${draggedItemId === item.id ? 'dragging' : ''}`} onClick={() => loadRequest(item)}>
                            <div className="tree-request-header">
                                <span className={`badge method-${item.method}`}>{item.method}</span>
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
                                        className="ghost tree-title"
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setEditingRequestId(item.id);
                                            setRequestNameDraft(item.name);
                                        }}
                                    >
                                        {item.name}
                                    </button>
                                )}
                                <div className="menu-wrap">
                                    <button
                                        className="ghost icon-button icon-plain"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenFolderMenuId((prev) => (prev === item.id ? "" : item.id));
                                        }}
                                        aria-label="Request options"
                                    >
                                        ⋮
                                    </button>
                                    {openFolderMenuId === item.id && (
                                        <div className="menu">
                                            <button
                                                className="ghost"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingRequestId(item.id);
                                                    setRequestNameDraft(item.name);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Rename
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    duplicateItem(item.id);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Duplicate
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setItemToMove(item);
                                                    setMoveTargetId("root");
                                                    setShowMoveModal(true);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Move
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteRequest(item.id);
                                                    setOpenFolderMenuId("");
                                                }}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            {item.description && <div className="tree-desc">{item.description}</div>}
                            {Array.isArray(item.tags) && item.tags.length > 0 && (
                                <div className="tree-tags">
                                    {item.tags.map((tag) => (
                                        <span className="tag" key={`${item.id}-${tag}`}>{tag}</span>
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
        <aside className="sidebar">
            <div className="sidebar-panel">
                <div className="panel-title header-row">
                    <span>{activeSidebar}</span>
                    {activeSidebar === "Collections" && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <button className="ghost" onClick={() => setShowCollectionModal(true)}>Manage</button>
                            <div className="menu-wrap">
                                <button className="ghost" onClick={() => setShowImportMenu(prev => !prev)}>Import</button>
                                {showImportMenu && (
                                    <div className="menu" style={{ right: 0, left: 'auto', minWidth: '150px' }}>
                                        <button className="ghost" onClick={() => { importCollection(); setShowImportMenu(false); }}>From File</button>
                                        <button className="ghost" onClick={() => { setShowImportTextModal(true); setShowImportMenu(false); }}>From Text</button>
                                        <button className="ghost" onClick={() => { setShowImportApiModal(true); setShowImportMenu(false); }}>From API URL</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                {activeSidebar === "Collections" && (
                    <div className="panel-body">
                        <div className="collection-section">
                            <div className="panel-row">
                                <select
                                    className="input compact"
                                    value={activeCollectionId}
                                    onChange={(e) => setActiveCollectionId(e.target.value)}
                                >
                                    {collections.map((col) => (
                                        <option key={col.id} value={col.id}>{col.name}</option>
                                    ))}
                                </select>
                                <button className="ghost icon-button" onClick={addCollection} title="Create Collection" aria-label="Create collection">
                                    +
                                </button>
                            </div>
                        </div>
                        <div className="collection-section">
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
                                        className="ghost folder-name"
                                        onDoubleClick={() => {
                                            setEditingCollectionName(true);
                                            setCollectionNameDraft(getActiveCollection()?.name || "");
                                        }}
                                    >
                                        {getActiveCollection()?.name || "Untitled Collection"}
                                    </button>
                                )}
                                <div className="menu-wrap" style={{ marginLeft: 'auto' }}>
                                    <button
                                        className="ghost icon-button"
                                        aria-label="Collection options"
                                        onClick={() => setShowCollectionMenu((prev) => !prev)}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
                                    </button>
                                    {showCollectionMenu && (
                                        <div className="menu">
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    addFolderToCollection();
                                                    setShowCollectionMenu(false);
                                                }}
                                            >
                                                Create Folder
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    addRequestToCollection();
                                                    setShowCollectionMenu(false);
                                                }}
                                            >
                                                Create Request
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    duplicateCollection(activeCollectionId);
                                                    setShowCollectionMenu(false);
                                                }}
                                            >
                                                Duplicate Collection
                                            </button>
                                            <button
                                                className="ghost"
                                                onClick={() => {
                                                    exportCollection(activeCollectionId);
                                                    setShowCollectionMenu(false);
                                                }}
                                            >
                                                Export Collection
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div
                                className={`panel-list ${dragOverItemId === 'root' ? 'drag-over' : ''}`}
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
                                style={{ minHeight: '100px', paddingBottom: '20px' }}
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
                                            const methodColor = item.request?.method === "GET" ? "var(--accent)" :
                                                item.request?.method === "POST" ? "var(--accent-2)" :
                                                    item.request?.method === "DELETE" ? "#ff5555" : "var(--accent-3)";

                                            // Make identical requests grouped locally look connected
                                            const isLast = idx === items.length - 1;

                                            return (
                                                <div key={idx} style={{
                                                    borderBottom: isLast ? "none" : "1px solid var(--border)",
                                                    padding: "10px 16px 10px 24px",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: "6px",
                                                    cursor: "pointer",
                                                    background: "var(--panel-2)",
                                                    transition: "background 0.1s ease",
                                                }} onClick={() => {
                                                    loadHistoryItem(item);
                                                }}
                                                    onMouseOver={(e) => e.currentTarget.style.background = "var(--panel-3)"}
                                                    onMouseOut={(e) => e.currentTarget.style.background = "var(--panel-2)"}
                                                >
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.80rem" }}>
                                                        <span style={{ color: methodColor, fontWeight: 700 }}>{item.request?.method}</span>
                                                        <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>{timeStr}</span>
                                                    </div>
                                                    <div style={{
                                                        fontSize: "0.85rem",
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        color: "var(--text)"
                                                    }} title={item.request?.url}>
                                                        {item.request?.url || "Unknown URL"}
                                                    </div>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                                                        <span style={{
                                                            fontSize: "0.70rem",
                                                            padding: "2px 6px",
                                                            borderRadius: "4px",
                                                            background: item.response?.status >= 200 && item.response?.status < 300 ? "rgba(46, 211, 198, 0.15)" : "rgba(255, 85, 85, 0.15)",
                                                            color: item.response?.status >= 200 && item.response?.status < 300 ? "var(--accent-2)" : "#ff5555",
                                                            fontWeight: 600
                                                        }}>
                                                            {item.response?.status} {item.response?.statusText}
                                                        </span>
                                                        <span style={{ fontSize: "0.70rem", color: "var(--muted)" }}>
                                                            {item.response?.time ? `${item.response.time}ms` : ""}
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
            <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid var(--border)' }}>
                <button
                    className="ghost"
                    style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
                    onClick={() => setShowGitHubSyncModal(true)}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                    GitHub Sync
                </button>
            </div>
        </aside>
    );
}
