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
  { key: "time", label: "Posted" },
  { key: "company", label: "Role & Company" },
  { key: "location", label: "Location" },
  { key: "comp", label: "Comp" },
  { key: "level", label: "Level" },
  { key: "tailored", label: "Tailored" },
  { key: "ats", label: "ATS" },
  { key: "fit", label: "Fit" },
];

export default function FeedTableToolbar({
  sortBy,
  onSortChange,
  query,
  onQueryChange,
  onFilterToggle,
  filtersOpen,
  onShare,
}: Props) {
  return (
    <div className="feed-table-toolbar">
      <div className="feed-table-toolbar-start">
        <span className="feed-table-views-label">Views</span>
        <button type="button" className="feed-table-tool" disabled title="Coming soon">
          Hide fields
        </button>
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
          <span className="feed-table-pill-x" aria-hidden>×</span>
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
        <button type="button" className="feed-table-tool" disabled title="Score colors active">
          Color
        </button>
      </div>

      <div className="feed-table-toolbar-end">
        <div className="feed-table-search">
          <span className="feed-table-search-icon" aria-hidden>⌕</span>
          <input
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
          Share
        </button>
      </div>
    </div>
  );
}
