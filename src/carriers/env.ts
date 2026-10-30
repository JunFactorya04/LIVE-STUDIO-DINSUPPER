// Which ECPay environment the seller chose: the test one (default, nothing really ships) or the
// real one. Kept per computer; shared by the carriers page and the order list.
const KEY = "live-studio.ecpay-stage";

export const readStage = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
};

export const writeStage = (stage: boolean): void => {
  try {
    localStorage.setItem(KEY, stage ? "1" : "0");
  } catch {
    /* the choice applies until the page is closed */
  }
};
