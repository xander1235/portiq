import React, { useEffect } from "react";

export function FullScreenModal({ isOpen, onClose, title, actions, children }) {
    if (!isOpen) return null;

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return (
        <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
            <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{ width: '90vw', height: '90vh', maxWidth: 'none', display: 'flex', flexDirection: 'column' }}
            >
                <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, marginBottom: '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ fontWeight: 600 }}>{title}</div>
                        {actions && <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{actions}</div>}
                    </div>
                    <button className="ghost icon-button" onClick={onClose} style={{ margin: "-8px", padding: "8px" }}>✕</button>
                </div>
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginTop: '16px' }}>
                    {children}
                </div>
            </div>
        </div>
    );
}
