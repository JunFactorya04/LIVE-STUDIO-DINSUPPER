// Whether this computer is currently sharing with a phone. Kept outside React so the
// background sync keeps running while the person is on another page.

let sharing = false;
const listeners = new Set<() => void>();

export const isSharing = (): boolean => sharing;

export function setSharing(on: boolean): void {
  if (sharing === on) return;
  sharing = on;
  listeners.forEach((l) => l());
}

export function subscribeSharing(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
