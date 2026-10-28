import { useState, useEffect } from "react";
import type { User } from "../types";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user || null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const response = await fetch('/api/push/subscription', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
          if (response.ok) await subscription.unsubscribe();
        }
      }
    } catch { /* Logout must still work when push is unavailable. */ }
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch { /* ignore — always clear local state */ }
    setUser(null);
    window.location.href = "/landing/index.html";
  }

  return { user, loading, logout };
}
