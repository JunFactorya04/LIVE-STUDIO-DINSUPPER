import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { LiveSessionStore, type LiveSessionSnapshot } from "./sessionStore";

const StoreContext = createContext<LiveSessionStore | null>(null);

export function LiveSessionProvider({
  store,
  children,
}: {
  store?: LiveSessionStore;
  children: ReactNode;
}) {
  const value = useMemo(() => store ?? new LiveSessionStore(), [store]);
  useEffect(() => {
    void value.restore();
    return () => void value.dispose();
  }, [value]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useLiveStore(): LiveSessionStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("LiveSessionProvider is missing");
  return store;
}

export function useLiveSession(): LiveSessionSnapshot {
  const store = useLiveStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
