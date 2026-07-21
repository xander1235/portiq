import React from "react";
import type { SearchEntity, SearchEntityType } from "../../utils/searchIndex";

interface SearchSuggestionsProps {
  results: SearchEntity[];
  highlightedIndex: number;
  onHover: (index: number) => void;
  onSelect: (entity: SearchEntity) => void;
}

const BADGE: Record<SearchEntityType, string> = {
  request: "REQ",
  folder: "DIR",
  collection: "COL",
  environment: "ENV",
};

export function SearchSuggestions({ results, highlightedIndex, onHover, onSelect }: SearchSuggestionsProps) {
  return (
    <div
      role="listbox"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        width: 340,
        maxHeight: 360,
        overflowY: "auto",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        zIndex: 50,
        padding: 4,
      }}
    >
      {results.length === 0 ? (
        <div style={{ padding: "8px 10px", color: "var(--muted)", fontSize: "0.8rem" }}>No results</div>
      ) : (
        results.map((entity, i) => (
          <div
            key={`${entity.type}-${entity.id}`}
            role="option"
            aria-selected={i === highlightedIndex}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus so blur-close doesn't cancel the click
              onSelect(entity);
            }}
            onMouseEnter={() => onHover(i)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 6,
              cursor: "pointer",
              background: i === highlightedIndex ? "var(--panel-2)" : "transparent",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                fontSize: "0.6rem",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "1px 4px",
                width: 30,
                textAlign: "center",
              }}
            >
              {BADGE[entity.type]}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "0.85rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {entity.label || "(untitled)"}
              </div>
              {entity.sublabel && (
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {entity.sublabel}
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default SearchSuggestions;
