// 7-ELEVEN's public map only understands Chinese. Sellers often type English or pinyin
// ("xinyi taipei", "Zhongshan Rd"), so common place names are turned into Chinese first.
// Only a small dictionary of cities, districts, big roads and place words is built in; a word
// that is not in it is reported back so the UI can say it was not understood.

const TABLE = `
taipei=台北;newtaipei=新北;keelung,jilong=基隆;taoyuan=桃園;hsinchu,xinzhu=新竹;miaoli=苗栗;taichung,taizhong=台中;
changhua=彰化;nantou=南投;yunlin=雲林;chiayi,jiayi=嘉義;tainan=台南;kaohsiung,gaoxiong=高雄;pingtung=屏東;
yilan=宜蘭;hualien=花蓮;taitung=台東;penghu=澎湖;kinmen=金門;lienchiang,matsu=連江;
zhongzheng,chungcheng=中正;datong,tatung=大同;zhongshan,chungshan=中山;songshan,sungshan=松山;daan,taan=大安;
wanhua,wanhwa=萬華;xinyi,hsinyi=信義;shilin,shihlin=士林;beitou,peitou=北投;neihu=內湖;nangang,nankang=南港;wenshan=文山;
banqiao,panchiao=板橋;sanchong,sanchung=三重;zhonghe,chunghe=中和;yonghe,yungho=永和;xinzhuang,hsinchuang=新莊;
xindian,hsintien=新店;tucheng=土城;luzhou=蘆洲;shulin=樹林;yingge=鶯歌;sanxia=三峽;tamsui,danshui=淡水;
linkou=林口;xizhi,hsichih=汐止;ruifang=瑞芳;zhongli,chungli=中壢;pingzhen=平鎮;bade=八德;luzhu=蘆竹;guishan=龜山;
dayuan=大園;guanyin=觀音;xinwu=新屋;yangmei=楊梅;longtan=龍潭;
xitun=西屯;beitun=北屯;nantun=南屯;fengyuan=豐原;dali=大里;taiping=太平;wuri=烏日;shalu=沙鹿;qingshui=清水;dajia=大甲;
zuoying=左營;sanmin=三民;gushan=鼓山;fengshan=鳳山;qianzhen=前鎮;xiaogang=小港;lingya=苓雅;xinxing=新興;yancheng=鹽埕;
nanzi=楠梓;gangshan=岡山;qijin=旗津;cianjin=前金;
anping=安平;yongkang=永康;rende=仁德;xinying=新營;
zhongxiao,chunghsiao=忠孝;renai,jenai=仁愛;xinsheng,hsinsheng=新生;heping=和平;minsheng=民生;minquan=民權;
zhonghua,chunghua=中華;guangfu=光復;jianguo,chienkuo=建國;chengde=承德;nanjing=南京;fuxing,fuhsing=復興;dunhua,tunhua=敦化;
roosevelt=羅斯福;civic=市民;zhongxin=中興;minzu=民族;zhongzhen=中正;wenhua=文化;datong=大同;
gongyuan=公園;zhonghuaroad=中華路;
road,rd=路;street,st=街;section,sec=段;lane=巷;alley=弄;avenue,ave=大道;district,dist=區;city=市;county=縣;
township=鄉;village=村;station,sta=站;hospital=醫院;university=大學;school=學校;park=公園;temple=廟;
mall=商場;bridge=橋;airport=機場;mrt=捷運;nightmarket=夜市;market=市場;stadium=體育館;library=圖書館;
`;

const DICT = new Map<string, string>();
for (const entry of TABLE.split(";")) {
  const [keys, zh] = entry.trim().split("=");
  if (!keys || !zh) continue;
  for (const k of keys.split(",")) DICT.set(k.trim(), zh);
}

/** Lower-case Latin text without tone marks, so "Zhōngshān" and "zhongshan" are the same word. */
export function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ü/gi, "u").toLowerCase();
}

const HAS_CJK = /[㐀-鿿]/;
const NOISE = new Set([
  "of",
  "the",
  "in",
  "near",
  "at",
  "and",
  "no",
  "number",
  "711",
  "7-11",
  "seven",
  "eleven",
  "store",
  "shop",
]);

export interface ParsedQuery {
  /** What to ask 7-ELEVEN for, best guess first (Chinese, or a store number). */
  keys: string[];
  /** Typed words that are not in the dictionary. */
  unknown: string[];
  /** The Chinese pieces the typed words were turned into. */
  understood: string[];
}

/**
 * Turn what was typed into search keys. Chinese and digits pass through unchanged; Latin words
 * are looked up one by one (two-word phrases first, so "night market" works).
 */
export function parseStoreQuery(input: string): ParsedQuery {
  const q = input.trim();
  if (!q) return { keys: [], unknown: [], understood: [] };
  if (/^\d+$/.test(q) || (HAS_CJK.test(q) && !/[a-z]/i.test(plain(q)))) {
    return { keys: [q], unknown: [], understood: [] };
  }
  const words = plain(q)
    .split(/[^a-z0-9㐀-鿿]+/)
    .filter(Boolean);
  const pieces: string[] = [];
  const unknown: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (HAS_CJK.test(w)) {
      pieces.push(w);
      continue;
    }
    const pair = words[i + 1] ? DICT.get(w + words[i + 1]) : undefined;
    if (pair) {
      pieces.push(pair);
      i++;
      continue;
    }
    const hit = DICT.get(w);
    if (hit) pieces.push(hit);
    else if (/^\d+$/.test(w) && w.length >= 3) pieces.push(w);
    else if (!NOISE.has(w)) unknown.push(w);
  }
  // Words that only describe a kind of place (road, street, district) narrow nothing by themselves.
  const generic = new Set([
    "路",
    "街",
    "段",
    "巷",
    "弄",
    "大道",
    "區",
    "市",
    "縣",
    "鄉",
    "村",
    "站",
  ]);
  const specific = pieces.filter((p) => !generic.has(p));
  const understood = [...new Set(pieces)];
  const keys = [...new Set(specific.length ? specific : pieces)].slice(0, 3);
  // A fully joined phrase ("信義區") is the most precise key when a suffix word was typed.
  if (specific.length === 1 && pieces.length > 1) {
    const joined = pieces.join("");
    if (!keys.includes(joined)) keys.unshift(joined);
  }
  return { keys, unknown, understood };
}

/** How many of the Chinese pieces appear in the store's name or address (for ranking). */
export function matchScore(pieces: readonly string[], text: string): number {
  return pieces.reduce((n, p) => (text.includes(p) ? n + 1 : n), 0);
}
