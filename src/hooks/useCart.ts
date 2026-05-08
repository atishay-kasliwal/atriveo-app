import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./useAuth";
import type { Job } from "../types";

const KEY = (uid: string) => `atriveo_cart_v1_${uid}`;

export interface CartItem {
  url: string;
  job: Job;
  addedAt: string;
}

interface CartData {
  items: CartItem[];
}

function empty(): CartData {
  return { items: [] };
}

function normalize(raw: unknown): CartData {
  if (!raw || typeof raw !== "object") return empty();
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.items)) return empty();
  const items: CartItem[] = [];
  for (const item of p.items) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    if (!i.url || !i.job || !i.addedAt) continue;
    items.push({ url: String(i.url), job: i.job as Job, addedAt: String(i.addedAt) });
  }
  return { items };
}

function load(uid: string): CartData {
  try {
    const raw = localStorage.getItem(KEY(uid)) ?? localStorage.getItem(KEY("anon"));
    return raw ? normalize(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

function persist(uid: string, data: CartData) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(data)); } catch { /* ignore */ }
}

function syncToServer(data: CartData) {
  fetch("/api/cart", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => { /* non-fatal */ });
}

export function useCart() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.email ?? "anon";

  const [data, setData] = useState<CartData>(empty);

  useEffect(() => {
    if (authLoading) return;
    const cached = load(uid);
    setData(cached);
    if (uid !== "anon") {
      fetch("/api/cart")
        .then((r) => (r.ok ? r.json() : null))
        .then((raw: unknown) => {
          const server = normalize(raw);
          const serverEmpty = server.items.length === 0;
          if (serverEmpty && cached.items.length > 0) {
            persist(uid, cached);
            syncToServer(cached);
          } else if (!serverEmpty) {
            setData(server);
            persist(uid, server);
          }
        })
        .catch(() => { /* stick with localStorage */ });
    }
  }, [uid, authLoading]);

  const addToCart = useCallback((job: Job) => {
    const url = job.job_url;
    if (!url) return;
    setData((prev) => {
      if (prev.items.some((i) => i.url === url)) return prev;
      const next: CartData = {
        items: [{ url, job, addedAt: new Date().toISOString() }, ...prev.items],
      };
      persist(uid, next);
      if (uid !== "anon") syncToServer(next);
      return next;
    });
  }, [uid]);

  const removeFromCart = useCallback((url: string) => {
    setData((prev) => {
      const next: CartData = { items: prev.items.filter((i) => i.url !== url) };
      persist(uid, next);
      if (uid !== "anon") syncToServer(next);
      return next;
    });
  }, [uid]);

  const isInCart = useCallback((url: string): boolean => {
    return data.items.some((i) => i.url === url);
  }, [data.items]);

  return { items: data.items, addToCart, removeFromCart, isInCart };
}
