export interface Place { states: string[]; remote: boolean; /** The state you are in now (this device), from "Use my location". */ here?: string | null }
export const STATES: [code: string, name: string][];
export const DEFAULT_PLACE: Readonly<{ states: readonly string[]; remote: boolean }>;
export function statesIn(location: string | null | undefined): Set<string>;
export function remoteOrUs(location: string | null | undefined): boolean;
export function placeRank(location: string | null | undefined, place?: { states: readonly string[]; remote: boolean; here?: string | null } | null): 0 | 1 | 2 | 3;
export function normalizePlace(input: unknown): Place;
export function parsePlace(input: unknown): Place | null;
export function placeQuery(place?: { states: readonly string[]; remote: boolean; here?: string | null } | null): string;
export function placeFromQuery(params: URLSearchParams): Place | null;
export function stateName(code: string): string;
export function stateAt(lat: number, lon: number, borders: Record<string, number[][]>): string | null;
