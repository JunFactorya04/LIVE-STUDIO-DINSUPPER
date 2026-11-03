import { TAIWAN_REGIONS, type TaiwanRegion } from "./taiwanRegions";

// Reads a typed Chinese address the way 7-ELEVEN's map needs it: city, district, then the road.
// "台南市新化區中正路12號" -> 台南市 / 新化區 / 中正路. The city or the 市/縣/區 endings may be
// left out ("新化中正路"); a district name shared by several cities ("信義區") gives one guess
// per city, so the screen can offer each one.

export interface AreaGuess {
  city: TaiwanRegion;
  district: string;
}

export interface AddressGuess {
  /** City named in the text (even when no district was found). */
  city?: TaiwanRegion;
  areas: AreaGuess[];
  /** What follows the district, up to the house number: usually the road. */
  road: string;
}

const short = (name: string) => (name.length > 2 ? name.slice(0, -1) : name);

function startWithName(text: string, name: string): string | undefined {
  if (text.startsWith(name)) return text.slice(name.length);
  const s = short(name);
  if (s !== name && s.length >= 2 && text.startsWith(s)) return text.slice(s.length);
  return undefined;
}

/** The road part: stops at a house number, lane digits or punctuation. */
function roadOf(rest: string): string {
  return rest.split(/[0-9０-９,，()（）\s]/)[0].slice(0, 10);
}

export function guessAddress(input: string): AddressGuess {
  const text = input.replace(/臺/g, "台").replace(/\s+/g, "");
  let city: TaiwanRegion | undefined;
  let rest = text;
  for (const c of TAIWAN_REGIONS) {
    const r = startWithName(text, c.zh);
    if (r !== undefined) {
      city = c;
      rest = r;
      break;
    }
  }
  const areas: AreaGuess[] = [];
  let after = "";
  for (const c of city ? [city] : TAIWAN_REGIONS) {
    for (const d of c.districts) {
      const r = startWithName(rest, d);
      // "中正路" is a road, not 中正區 + "路".
      if (r !== undefined && !/^[路街道段巷]/.test(r)) {
        areas.push({ city: c, district: d });
        after = r;
      }
    }
  }
  return { city, areas, road: areas.length > 0 ? roadOf(after) : "" };
}
