import { useCallback, useEffect, useState } from "react";

export type NotifPermission = "default" | "granted" | "denied" | "unsupported";

export function useNotifications() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [permission, setPermission] = useState<NotifPermission>(
    supported ? (Notification.permission as NotifPermission) : "unsupported",
  );

  useEffect(() => {
    if (!supported) return;
    setPermission(Notification.permission as NotifPermission);
  }, [supported]);

  const requestPermission = useCallback(async () => {
    if (!supported) return;
    const result = await Notification.requestPermission();
    setPermission(result as NotifPermission);
  }, [supported]);

  const notify = useCallback((title: string, body: string, icon = "/favicon.svg") => {
    if (!supported || Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, { body, icon });
      setTimeout(() => n.close(), 8000);
    } catch {
      /* ignore — some browsers block even after grant */
    }
  }, [supported]);

  return { supported, permission, requestPermission, notify };
}
