import { useState } from "react";
import type { ApplyMetadata, ApplyRecord, TrackerStatus } from "../hooks/useApplyTracker";

interface Props {
  jobUrl: string;
  defaultCompany: string;
  defaultTitle: string;
  trackerRecord: ApplyRecord | null;
  onAddToTracker: (jobUrl: string, title: string, company: string, metadata?: ApplyMetadata) => void;
  onSetTrackerStatus: (jobUrl: string, status: TrackerStatus) => void;
  onSetTrackerNotes: (jobUrl: string, notes: string) => void;
  onClose: () => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function TrackerAddForm({
  jobUrl,
  defaultCompany,
  defaultTitle,
  trackerRecord,
  onAddToTracker,
  onSetTrackerStatus,
  onSetTrackerNotes,
  onClose,
}: Props) {
  const [company, setCompany] = useState(trackerRecord?.company || defaultCompany);
  const [title, setTitle] = useState(trackerRecord?.title || defaultTitle);
  const [status, setStatus] = useState<TrackerStatus>(trackerRecord?.trackerStatus ?? null);
  const [notes, setNotes] = useState(trackerRecord?.notes || "");
  const isManualUrl = jobUrl.startsWith("manual://");

  const handleSave = () => {
    if (!trackerRecord) {
      // First save: create + set status/notes in one atomic update so the
      // separate setTrackerStatus/setTrackerNotes calls (which no-op if the
      // record doesn't exist yet) don't race the record's own creation.
      onAddToTracker(jobUrl, title.trim(), company.trim(), { trackerStatus: status, notes });
    } else {
      onSetTrackerStatus(jobUrl, status);
      onSetTrackerNotes(jobUrl, notes);
    }
    onClose();
  };

  return (
    <div className="tracker-form">
      <div className="tracker-form-head">
        <span>Tracker entry</span>
        <button type="button" className="tracker-form-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {isManualUrl ? (
        <p className="tracker-form-hint">
          No job URL for this posting — this entry stays local and won't sync to the Atriveo tracker.
        </p>
      ) : null}

      <div className="tracker-form-fields">
        <label className="mt-field">
          <span>Company</span>
          <input
            type="text"
            className="mt-field-input"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
        <label className="mt-field">
          <span>Role</span>
          <input
            type="text"
            className="mt-field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="mt-field">
          <span>Status</span>
          <select
            className="mt-field-input"
            value={status ?? ""}
            onChange={(e) => setStatus((e.target.value || null) as TrackerStatus)}
          >
            <option value="">Applied (default)</option>
            <option value="applied">Applied</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label className="mt-field">
          <span>Date applied</span>
          <input
            type="text"
            className="mt-field-input"
            value={formatDate(trackerRecord?.lastAppliedAt)}
            disabled
          />
        </label>
      </div>

      <label className="mt-field tracker-form-notes">
        <span>Notes</span>
        <textarea
          className="mt-field-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Referral, recruiter contact, follow-up date…"
        />
      </label>

      <div className="tracker-form-actions">
        <button type="button" className="manual-tailor-foot-btn manual-tailor-foot-btn--primary" onClick={handleSave}>
          {trackerRecord ? "Save changes" : "Add to tracker"}
        </button>
        <button type="button" className="manual-tailor-foot-btn manual-tailor-foot-btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
