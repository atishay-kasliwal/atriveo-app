import { useEffect, useRef } from "react";
import type { SortBy } from "../pages/Dashboard.types";

interface Props {
  jobCount: number;
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onFilterToggle: () => void;
  filtersOpen: boolean;
  onShare: () => void;
  shareMessage?: string;
}

const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "rating", label: "Rating" },
  { key: "title", label: "Role" },
  { key: "time", label: "Posted" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "comp", label: "Comp" },
  { key: "level", label: "Level" },
  { key: "tailored", label: "Tailored" },
  { key: "ats", label: "ATS" },
  { key: "fit", label: "Fit" },
];

export default function FeedTableToolbar({
  jobCount,
  sortBy,
  onSortChange,
  query,
  onQueryChange,
  onFilterToggle,
  filtersOpen,
  onShare,
  shareMessage,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="feed-table-toolbar">
      <div className="feed-table-toolbar-start">
        <span className="feed-table-views-label">{jobCount} jobs</span>
        <button
          type="button"
          className={`feed-table-tool${filtersOpen ? " is-active" : ""}`}
          onClick={onFilterToggle}
          aria-pressed={filtersOpen}
        >
          Filter
        </button>
        <span className="feed-table-tool feed-table-tool--pill is-active">
          Grouped by Company
        </span>
        <label className="feed-table-sort">
          <span className="feed-table-sort-label">Sort</span>
          <select
            className="feed-table-sort-select"
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortBy)}
          >
            {SORT_OPTIONS.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="feed-table-toolbar-end">
        <div className="feed-table-search">
          <span className="feed-table-search-icon" aria-hidden>⌕</span>
          <input
            ref={searchRef}
            type="search"
            className="feed-table-search-input"
            placeholder="Search jobs, companies, skills…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search jobs"
          />
          <kbd className="feed-table-search-kbd">⌘K</kbd>
        </div>
        <button type="button" className="feed-table-tool feed-table-tool--share-dark" onClick={onShare}>
          {shareMessage || "Share"}
        </button>
      </div>
    </div>
  );
}
