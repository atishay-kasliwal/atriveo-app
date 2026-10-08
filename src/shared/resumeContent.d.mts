export interface ContentBullet { ac_id: string; facet: string | null; text: string; custom?: boolean }
export interface ContentChange { kind: "section" | "skills"; si: number; current: string; originalHashInput?: string; bullets?: ContentBullet[]; skills?: string[] }
export function applyContentChanges<T extends {kind: "experience" | "project"; bullets: ContentBullet[]}>(sections:T[],skills:string,changes:ContentChange[]):{sections:T[];skills:string};
