// Taiwan shipping carriers the seller may use, and what each one needs to connect.
// Nothing here talks to a carrier: it lists how each one is reached and which credentials the
// seller keeps in the OS keychain. A carrier is only ever called "connected" by a real check
// against it, so until one is implemented the best status is "credentials saved".

export type CarrierMode = "excel" | "api" | "login";

export type CarrierField =
  | "merchantId"
  | "hashKey"
  | "hashIv"
  | "partnerId"
  | "partnerKey"
  | "shopId"
  | "customerId"
  | "token"
  | "account"
  | "password"
  | "senderName"
  | "senderPhone";

/** Fields that hold secrets are written as password inputs and can never be read back. */
export const SECRET_FIELDS: ReadonlySet<CarrierField> = new Set([
  "hashKey",
  "hashIv",
  "partnerKey",
  "token",
  "password",
]);

export interface Carrier {
  id: string;
  /** Name as shown in Taiwan. */
  zh: string;
  /** Name in Vietnamese for the Vietnamese UI. */
  vi: string;
  /** Letters on the tile when the carrier has no logo file in the app. */
  mark: string;
  /** The carrier's own sign-in / seller console page (opened in the browser, never auto-filled). */
  consoleUrl: string;
  /** The carrier's own parcel-tracking page. */
  trackUrl: string;
  /** True when the app itself can call this carrier: check the keys, create a waybill, track. */
  live: boolean;
  tone: "blue" | "green" | "orange" | "red" | "purple" | "teal" | "indigo";
  modes: CarrierMode[];
  fields: CarrierField[];
  /** True when the app can already produce this carrier's import file. */
  excel: boolean;
}

export const CARRIERS: Carrier[] = [
  {
    id: "ecpay",
    zh: "綠界科技 ECPay 物流",
    vi: "ECPay (cổng gộp nhiều hãng)",
    mark: "EC",
    tone: "green",
    modes: ["api"],
    fields: ["merchantId", "hashKey", "hashIv", "senderName", "senderPhone"],
    excel: false,
    live: true,
    consoleUrl: "https://vendor.ecpay.com.tw/",
    trackUrl: "https://www.ecpay.com.tw/Service/Logistics_Tracking",
  },
  {
    id: "seven",
    zh: "7-ELEVEN 賣貨便",
    vi: "7-ELEVEN (MyShip)",
    mark: "7",
    tone: "orange",
    modes: ["excel", "login"],
    fields: ["account", "password"],
    excel: true,
    live: false,
    consoleUrl: "https://myship.7-11.com.tw/",
    trackUrl: "https://myship.7-11.com.tw/Home/Main",
  },
  {
    id: "family",
    zh: "全家 好賣+",
    vi: "FamilyMart (Haomai+)",
    mark: "FM",
    tone: "teal",
    modes: ["excel", "login"],
    fields: ["account", "password"],
    excel: false,
    live: false,
    consoleUrl: "https://myfamiport.family.com.tw/",
    trackUrl: "https://www.famiport.com.tw/Web_Famiport/page/parcel_search.aspx",
  },
  {
    id: "shopee",
    zh: "蝦皮店到店",
    vi: "Shopee (Giao tại cửa hàng)",
    mark: "S",
    tone: "red",
    modes: ["api"],
    fields: ["partnerId", "partnerKey", "shopId"],
    excel: false,
    live: false,
    consoleUrl: "https://seller.shopee.tw/",
    trackUrl: "https://shopee.tw/",
  },
  {
    id: "tcat",
    zh: "黑貓宅急便",
    vi: "T-Cat (Mèo đen)",
    mark: "TC",
    tone: "indigo",
    modes: ["api"],
    fields: ["customerId", "token"],
    excel: false,
    live: false,
    consoleUrl: "https://www.t-cat.com.tw/",
    trackUrl: "https://www.t-cat.com.tw/inquire/trace.aspx",
  },
  {
    id: "hct",
    zh: "新竹物流",
    vi: "Hsinchu Logistics (HCT)",
    mark: "HC",
    tone: "blue",
    modes: ["login", "api"],
    fields: ["customerId", "account", "password"],
    excel: false,
    live: false,
    consoleUrl: "https://www.hct.com.tw/",
    trackUrl: "https://www.hct.com.tw/search/searchgoods_n.aspx",
  },
  {
    id: "post",
    zh: "中華郵政",
    vi: "Chunghwa Post (Bưu điện)",
    mark: "CP",
    tone: "purple",
    modes: ["login"],
    fields: ["account", "password"],
    excel: false,
    live: false,
    consoleUrl: "https://www.post.gov.tw/",
    trackUrl: "https://postserv.post.gov.tw/pstmail/main_mail.html",
  },
];

export const slotFor = (carrier: string, field: CarrierField): `carrier-${string}` =>
  `carrier-${carrier}-${field.toLowerCase()}`;

export type CarrierStatus = "none" | "partial" | "saved" | "excel";

/** From which fields are filled: nothing, some of them, or all (saved, not verified). */
export function statusOf(c: Carrier, filled: ReadonlySet<CarrierField>): CarrierStatus {
  const n = c.fields.filter((f) => filled.has(f)).length;
  if (n === 0) return c.excel ? "excel" : "none";
  return n === c.fields.length ? "saved" : "partial";
}
