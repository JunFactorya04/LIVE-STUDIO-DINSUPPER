// Code 128 (subset B: ASCII 32-126), drawn as bars. Subset B carries the letters, digits and
// punctuation of a unit code like "A12-000001". Each symbol is 11 modules: three bars and three
// spaces whose widths are listed here.

const PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
] as const; // values 0..105; 103 = start A, 104 = start B, 105 = start C
const STOP = "2331112";
const START_B = 104;

/** True when every character can be written in subset B. */
export const canEncode = (text: string): boolean =>
  text.length > 0 && text.length <= 40 && /^[\x20-\x7e]+$/.test(text);

/** Symbol values including start and checksum (the stop pattern is added when drawing). */
export function symbols(text: string): number[] {
  if (!canEncode(text)) throw new Error("BAD_BARCODE_TEXT");
  const values = Array.from(text, (c) => c.charCodeAt(0) - 32);
  const sum = values.reduce((n, v, i) => n + v * (i + 1), START_B);
  return [START_B, ...values, sum % 103];
}

/** Bars as module runs: true = bar, false = space. A quiet zone is NOT included. */
export function modules(text: string): boolean[] {
  const out: boolean[] = [];
  const push = (widths: string) => {
    let bar = true;
    for (const w of widths) {
      for (let i = 0; i < Number(w); i++) out.push(bar);
      bar = !bar;
    }
  };
  for (const v of symbols(text)) push(PATTERNS[v]);
  push(STOP);
  return out;
}

export const MODULES_PATTERNS = PATTERNS;
