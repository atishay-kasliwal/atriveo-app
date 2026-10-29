import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { finishEvent, loadEvents, removeEvent, saveEvent, type CalendarEvent, type Person } from './network';
import { nyToIso } from './ny-time';

const TZ = 'America/New_York';
const REMIND: Record<number, string> = { 0: 'At the time', 15: '15 minutes before', 60: '1 hour before', 1440: '1 day before' };
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/** Calendar events for your network: add one with a reminder, see what is coming up, mark it done. */
export default function NetworkCalendar({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('09:00');
  const [remind, setRemind] = useState(15);
  const [personId, setPersonId] = useState('');
  const [note, setNote] = useState('');
  const sorted = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name)), [people]);
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name;

  const refresh = useCallback(() => loadEvents().then(setEvents).catch(() => setError('Your calendar could not be loaded.')), []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const at = nyToIso(`${date}T${time}`);
    if (!at) { setError('Pick a date and time.'); return; }
    setBusy(true); setError('');
    try {
      await saveEvent({ title: title.trim(), at, remind, personId: personId || null, note: note.trim() });
      setTitle(''); setNote(''); setPersonId('');
      await refresh();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function act(run: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await run(); await refresh(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div id="nw-canvas-calendar" className="nw-canvas-popover nw-canvas-calendar" role="dialog" aria-label="Calendar" data-canvas-controls>
      <div className="nw-canvas-panel-head"><b>Calendar</b><button type="button" className="nw-x" aria-label="Close calendar" onClick={onClose}>×</button></div>
      <form className="nw-cal-form" onSubmit={add}>
        <label><span>Title</span><input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coffee with Ankit" /></label>
        <div className="nw-cal-row">
          <label><span>Date</span><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label><span>Time (New York)</span><input type="time" required value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        <label><span>Remind me</span>
          <select value={remind} onChange={(e) => setRemind(Number(e.target.value))}>
            {Object.entries(REMIND).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label><span>Person (optional)</span>
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">No one</option>
            {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}{p.company ? ` · ${p.company}` : ''}</option>)}
          </select>
        </label>
        <label><span>Note (optional)</span><input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button type="submit" className="nw-cal-save" disabled={busy}>Add to calendar</button>
      </form>
      {error && <p className="nw-cal-error" role="alert">{error}</p>}
      <h3 className="nw-cal-heading">Coming up</h3>
      {events === null && !error && <p className="nw-cal-empty">Loading…</p>}
      {events?.length === 0 && <p className="nw-cal-empty">Nothing scheduled. Add an event above.</p>}
      <ul className="nw-cal-list">
        {events?.map((event) => (
          <li key={event.id}>
            <div>
              <b>{event.title}</b>
              <small>{when(event.at)} · {REMIND[event.remind] ?? 'Reminder'}{personName(event.personId) ? ` · ${personName(event.personId)}` : ''}</small>
              {event.note && <small>{event.note}</small>}
            </div>
            <button type="button" disabled={busy} onClick={() => void act(() => finishEvent(event.id))}>Done</button>
            <button type="button" className="nw-x" disabled={busy} aria-label={`Remove ${event.title}`} onClick={() => void act(() => removeEvent(event.id))}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
