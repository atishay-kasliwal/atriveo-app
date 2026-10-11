import { useCallback, useEffect, useState } from 'react';
import { getTailorServerBase } from '../utils/tailorServer';

export interface OutreachContact {
  email: string; type: 'hiring' | 'general' | 'recruiter' | 'uncertain' | 'blocked'; firstName: string; lastName: string;
  title: string; profileUrl: string; sourceUrl: string; notes?: string; evidence?: string; publishedHiring?: boolean; foundAt?: string;
}
export interface OutreachDraft {
  id: string; revision: string; applicationId: string | null; jobUrl: string; company: string; title: string;
  website: string; websiteConfirmed: boolean; appliedAt: string | null; contact: OutreachContact; identityConfirmed: boolean;
  autoWhenApplied: boolean; subject: string; body: string; attachment: { id: string; name: string; sha256: string; bytes: number } | null;
  status: string; scheduledAt: string | null; sentAt?: string; updatedAt: string; error: string | null;
  discovery: { contacts: OutreachContact[]; pages: string[]; errors: string[]; portalOnly: boolean; checkedAt: string } | null;
}
export interface OutreachDetail {
  draft: OutreachDraft; contacts: OutreachContact[]; previous: OutreachDraft[];
  history: Array<{ id: string; at: string; status: string; messageId: string; error?: string; snapshot?: OutreachDraft }>;
}
export interface OutreachSettingsData {
  senderName: string; senderEmail: string; signature: string; pitch: string;
  dailyLimit: number; companyCooldownDays: number; cancelWindowMinutes: number; paused: boolean; autoHiring: boolean; connected: boolean;
  subjectTemplate: string; bodyTemplate: string;
}
export interface OutreachTarget { id?: string; applicationId?: string; jobUrl?: string; }
export const outreachLabel = (status?: string) => ({ blocked: 'Blocked', draft: 'Draft', needs_review: 'Needs review', no_contact: 'No contact found', queued: 'Queued', sending: 'Sending', sent: 'Sent', uncertain: 'Send uncertain', skipped: 'Skipped', failed: 'Failed' })[status || ''] || 'Prepare outreach';
export async function outreachApi<T>(route: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${getTailorServerBase()}/outreach/${route}`, {
    method: body === undefined ? 'GET' : method, credentials: 'include', cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({ error: 'Outreach service unavailable. Restart the local service with the updated code.' }));
  if (!response.ok || result.ok === false) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}
export function useOutreachList() {
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const result = await outreachApi<{ drafts: OutreachDraft[] }>('list'); setDrafts(result.drafts); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { const first = setTimeout(() => void refresh(), 0); const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30000); return () => { clearTimeout(first); clearInterval(timer); }; }, [refresh]);
  return { drafts, error, refresh };
}
