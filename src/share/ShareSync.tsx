import { useEffect, useSyncExternalStore } from "react";
import { useLiveStore } from "../live/useLiveSession";
import { isRemote } from "../platform/backend";
import { isSharing, subscribeSharing } from "./sharing";

const PHONE_POLL_MS = 2500;
const DESKTOP_POLL_MS = 3000;

/**
 * Keeps the phone and the computer looking at the same data. The phone reads the computer's
 * database every few seconds; the computer, while sharing, picks up orders and replies the
 * phone saved. Renders nothing.
 */
export function ShareSync() {
  const store = useLiveStore();
  const sharing = useSyncExternalStore(subscribeSharing, isSharing);
  const remote = isRemote();

  useEffect(() => {
    if (!remote && !sharing) return;
    const tick = () => void (remote ? store.refreshFromDb() : store.mergeFromDb());
    if (remote) tick();
    const id = window.setInterval(tick, remote ? PHONE_POLL_MS : DESKTOP_POLL_MS);
    return () => window.clearInterval(id);
  }, [remote, sharing, store]);

  return null;
}
