// One-shot hand-over from another page (e.g. the A-Z routine) to the shipping form: the TikTok
// id of the buyer whose order should be created. Read once, then cleared.

let pending: string | undefined;

export const setShipPrefill = (tiktokId: string): void => {
  pending = tiktokId;
};

export const takeShipPrefill = (): string | undefined => {
  const v = pending;
  pending = undefined;
  return v;
};
