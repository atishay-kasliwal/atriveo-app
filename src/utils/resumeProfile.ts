// Client for the resume header identity stored by the tailor sidecar.
// The sidecar owns the file (data/resume-profile.json) and the resume engine
// reads it directly, so this is the only place the web needs to touch.

import { getTailorServerBase, tailorSidecarErrorMessage } from "./tailorServer";

export interface ResumeProfile {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

export const RESUME_PROFILE_FIELDS: Array<{
  key: keyof ResumeProfile;
  label: string;
  hint: string;
  type?: string;
}> = [
  { key: "name",      label: "Name",            hint: "Printed in large type at the top" },
  { key: "title",     label: "Default title",   hint: "Used when the job title and JD say nothing usable" },
  { key: "email",     label: "Email",           hint: "Becomes the mailto: link", type: "email" },
  { key: "phone",     label: "Phone",           hint: "Shown as plain text" },
  { key: "location",  label: "Default location", hint: "Used when a posting names no location, or several" },
  { key: "linkedin",  label: "LinkedIn URL",    hint: "Linked from the word “Linkedin”", type: "url" },
  { key: "github",    label: "GitHub URL",      hint: "Linked from the word “Github”", type: "url" },
  { key: "portfolio", label: "Portfolio URL",   hint: "Linked from the word “Portfolio”", type: "url" },
];

interface ProfileResponse {
  ok?: boolean;
  profile?: ResumeProfile;
  defaults?: ResumeProfile;
  error?: string;
}

async function readJson(res: Response): Promise<ProfileResponse> {
  const data = (await res.json().catch(() => ({}))) as ProfileResponse;
  if (!res.ok || !data.ok || !data.profile) {
    throw new Error(data.error ?? tailorSidecarErrorMessage(res.status));
  }
  return data;
}

export async function fetchResumeProfile(): Promise<{ profile: ResumeProfile; defaults: ResumeProfile }> {
  const res = await fetch(`${getTailorServerBase()}/resume-profile`, { cache: "no-store" });
  const data = await readJson(res);
  return { profile: data.profile!, defaults: data.defaults ?? data.profile! };
}

/** Partial patch — omitted fields keep their current value. */
export async function saveResumeProfile(patch: Partial<ResumeProfile>): Promise<ResumeProfile> {
  const res = await fetch(`${getTailorServerBase()}/resume-profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson(res);
  return data.profile!;
}
