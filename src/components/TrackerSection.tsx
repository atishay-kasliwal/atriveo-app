import type { ApplyRecord, TrackerStatus } from "../hooks/useApplyTracker";
import type { ManualTailorSession } from "../utils/manualJob";

interface TrackedRow {
  session: ManualTailorSession;
  record: ApplyRecord;
}

interface Props {
  sessions: ManualTailorSession[];
  getTrackerRecord: (jobKey: string) => ApplyRecord | null;
  onSelectSession: (sessionId: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function statusLabel(status: TrackerStatus): string {
  if (status === "applied") return "Applied";
  if (status === "rejected") return "Rejected";
  return "Applied";
}

export default function TrackerSection({ sessions, getTrackerRecord, onSelectSession }: Props) {
  const rows: TrackedRow[] = sessions
    .map((session) => {
      const record = getTrackerRecord(session.jobKey);
      return record ? { session, record } : null;
    })
    .filter((row): row is TrackedRow => row !== null);

  if (rows.length === 0) return null;

  return (
    <section className="mt-tracker-section" aria-label="Tracked applications">
      <div className="mt-tracker-section-head">
        <h2>Tracker</h2>
        <span className="mt-rail-count">{rows.length}</span>
      </div>
      <div className="mt-tracker-table-wrap">
        <table className="mt-tracker-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Company</th>
              <th>Status</th>
              <th>Date applied</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ session, record }) => (
              <tr key={session.id}>
                <td>
                  <button type="button" className="mt-tracker-row-link" onClick={() => onSelectSession(session.id)}>
                    {record.title || session.title}
                  </button>
                </td>
                <td>{record.company || session.company}</td>
                <td>
                  <span className={`mt-tracker-status mt-tracker-status--${record.trackerStatus || "applied"}`}>
                    {statusLabel(record.trackerStatus)}
                  </span>
                </td>
                <td>{formatDate(record.lastAppliedAt)}</td>
                <td className="mt-tracker-notes-cell">{record.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
