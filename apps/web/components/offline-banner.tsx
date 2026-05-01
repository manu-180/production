"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * OfflineBanner — shows a sticky banner when user is offline.
 * Uses navigator.onLine and 'online'/'offline' event listeners.
 * Auto-hides when connection is restored.
 */
export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Only render after hydration to avoid mismatch
  if (!mounted || isOnline) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 px-4 py-2 sm:py-3 flex items-center gap-2 text-sm sm:text-base font-medium shadow-md animate-in fade-in slide-in-from-top-2 duration-300"
      role="alert"
      aria-live="polite"
    >
      <WifiOff className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
      <span>You're offline — viewing cached data</span>
    </div>
  );
}
