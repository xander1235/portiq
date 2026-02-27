import React, { useState } from "react";
import styles from "./Sidebar.module.css";

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
    const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);

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
                                <span className={`${styles.methodBadge} ${item.method ? styles[item.method.toLowerCase()] : ''}`}>{item.method}</span>
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
                <div className={`${styles.panelTitle} ${styles.headerRow}`}>
                    <span>{activeSidebar}</span>
                    {activeSidebar === "Collections" && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <button className="ghost" onClick={() => setShowCollectionModal(true)}>Manage</button>
                            <div className={styles.menuWrap}>
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
                    <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                        <div className={styles.collectionSection}>
                            <div className="panel-row">
                                <div className={styles.menuWrap} style={{ flex: 1, position: 'relative' }}>
                                    <button
                                        style={{
                                            width: '100%',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                            padding: '8px 12px',
                                            height: '36px',
                                            background: 'var(--panel)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '8px',
                                            color: 'var(--text)',
                                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                            boxShadow: showCollectionDropdown ? '0 0 0 2px rgba(46, 211, 198, 0.2)' : '0 2px 4px rgba(0,0,0,0.1)',
                                            borderColor: showCollectionDropdown ? 'var(--accent-2)' : 'var(--border)'
                                        }}
                                        onMouseOver={(e) => {
                                            if (!showCollectionDropdown) {
                                                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                                                e.currentTarget.style.background = 'var(--panel-3)';
                                            }
                                        }}
                                        onMouseOut={(e) => {
                                            if (!showCollectionDropdown) {
                                                e.currentTarget.style.borderColor = 'var(--border)';
                                                e.currentTarget.style.background = 'var(--panel)';
                                            }
                                        }}
                                        onClick={() => setShowCollectionDropdown(prev => !prev)}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--accent-2)' }}>
                                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                            </svg>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: 500 }}>
                                                {collections.find(c => c.id === activeCollectionId)?.name || "Select Collection"}
                                            </span>
                                        </div>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: '20px',
                                            height: '20px',
                                            borderRadius: '4px',
                                            background: 'rgba(255,255,255,0.05)',
                                            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            transform: showCollectionDropdown ? 'rotate(180deg)' : 'rotate(0)'
                                        }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="6 9 12 15 18 9"></polyline>
                                            </svg>
                                        </div>
                                    </button>
                                    {showCollectionDropdown && (
                                        <>
                                            <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setShowCollectionDropdown(false)}></div>
                                            <div
                                                className="menu"
                                                style={{
                                                    width: '100%',
                                                    top: 'calc(100% + 6px)',
                                                    maxHeight: '300px',
                                                    overflowY: 'auto',
                                                    padding: '6px',
                                                    borderRadius: '10px',
                                                    boxShadow: '0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)',
                                                    background: 'var(--panel)',
                                                    zIndex: 100,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '2px'
                                                }}
                                            >
                                                <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
                                                    Your Collections
                                                </div>
                                                {collections.map((col) => {
                                                    const isActive = col.id === activeCollectionId;
                                                    return (
                                                        <button
                                                            key={col.id}
                                                            style={{
                                                                width: '100%',
                                                                textAlign: 'left',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '10px',
                                                                color: isActive ? 'var(--accent-2)' : 'var(--text)',
                                                                backgroundColor: isActive ? 'rgba(46, 211, 198, 0.1)' : 'transparent',
                                                                fontWeight: isActive ? 600 : 500,
                                                                fontSize: '13px',
                                                                padding: '8px 10px',
                                                                borderRadius: '6px',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                transition: 'all 0.15s ease'
                                                            }}
                                                            onMouseOver={(e) => {
                                                                if (!isActive) e.currentTarget.style.backgroundColor = 'var(--panel-2)';
                                                            }}
                                                            onMouseOut={(e) => {
                                                                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                                                            }}
                                                            onClick={() => {
                                                                setActiveCollectionId(col.id);
                                                                setShowCollectionDropdown(false);
                                                            }}
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill={isActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={isActive ? "0" : "2"} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }}>
                                                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                                            </svg>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {col.name}
                                                            </span>
                                                            {isActive && (
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                                                                    <polyline points="20 6 9 17 4 12"></polyline>
                                                                </svg>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                                <button
                                    className="ghost icon-button"
                                    onClick={addCollection}
                                    title="Create Collection"
                                    aria-label="Create collection"
                                    style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '8px',
                                        background: 'var(--panel)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text)',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                                        e.currentTarget.style.background = 'var(--panel-3)';
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--border)';
                                        e.currentTarget.style.background = 'var(--panel)';
                                    }}
                                >
                                    +
                                </button>
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
        </aside >
    );
}
