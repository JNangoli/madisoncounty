/*!
 * FragmentDB: store any data (text, JSON, files) in a URL #fragment.
 * Client-side only, zero dependencies, works in the main thread, a Worker or an iframe.
 */
const te = new TextEncoder(), td = new TextDecoder();
const VERSION = 2;
const CM_VERSION = 'cm2';            // bump if CORPUS changes, so old links fail cleanly
const CM_MAX = 256 * 1024;           // skip the smart compressor above this payload size
const COMP = ['none', 'deflate-raw', 'brotli', 'cm'];
const FMT = ['text', 'json', 'json-columnar', 'pack', 'pack-dict', 'file', 'schema'];
const [TEXT, JSONF, COLS, PACK, PACKD, FILE, SCHEMA] = [0, 1, 2, 3, 4, 5, 6];
const MAGIC = te.encode('FDB2');
export const LINK_SAFE = 2000;       // links up to this length are safe in chat apps, email and QR

const CORPUS = `The city council met on Tuesday evening to review the proposed budget for the next fiscal year. Members of the public were invited to comment before the vote.
Thank you for your request. We have received your application and it is currently under review. You will receive an email when the status of your application changes.
Please note that the office will be closed on Monday for the holiday. Regular hours will resume on Tuesday at 8:00 a.m.
The department is responsible for the maintenance of streets, sidewalks, storm drains, street lights and traffic signals throughout the county.
Residents can report a problem online, by phone, or in person at the customer service desk. Please include the address, a short description and a photo if possible.
Agenda: 1. Call to order. 2. Approval of the minutes from the previous meeting. 3. Public comment. 4. Old business. 5. New business. 6. Reports from staff. 7. Adjournment.
Action items: follow up with the vendor about the contract, update the project schedule, and send the revised estimate to the finance director by the end of the week.
The public hearing on the zoning amendment has been scheduled for next month. Written comments must be submitted at least five business days before the hearing.
Permit types include building, electrical, plumbing, mechanical, demolition, sign, fence, driveway and special event permits. Fees are listed in the fee schedule.
If you have any questions, please contact us at the number below or reply to this message. We are happy to help.
Summary of the report: total requests increased by 12 percent compared with the same period last year, while the average response time decreased from 6 days to 4 days.
The water utility will perform scheduled maintenance in the north district. Some customers may experience low water pressure between 9:00 a.m. and 3:00 p.m.
Parks and recreation programs are open for registration. Programs include youth sports, swimming lessons, summer camps, senior fitness classes and community events.
The police and fire departments responded to a total of 1,245 calls for service this month. Most calls were medical emergencies and traffic incidents.
Employees must submit timesheets every two weeks. Overtime must be approved in advance by a supervisor. Leave requests should be entered in the system at least one week ahead.
Notice of public meeting. Date, time and location are listed below. The meeting is open to the public and will also be streamed online. Accommodations are available on request.
Invoice number, purchase order, vendor name, amount due, due date, payment terms, account code, description of goods or services, approved by, date approved.
January February March April May June July August September October November December. Monday Tuesday Wednesday Thursday Friday Saturday Sunday.
Name, first name, last name, email address, phone number, street address, city, state, zip code, county, country, date of birth, account number, reference number.
the of and to in is that for it as was with be by on not he this are or his from at which but have an they you were her she there been one all we their has would when if so no what up out them about more into do can only other new some could time these two may then first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three
To whom it may concern. Dear resident. Dear Sir or Madam. Best regards. Kind regards. Sincerely. Thank you for your time and attention.
https://www.example.gov/services/permits?id=12345&type=building https://www.example.com/news/2026/01/15/update.html mailto:info@example.gov
{"id":1,"name":"John Smith","email":"john.smith@example.com","phone":"555-0100","address":{"street":"123 Main Street","city":"Springfield","state":"IL","zip":"62701"},"status":"active","type":"resident","created_at":"2026-01-15T09:30:00Z","updated_at":"2026-02-01T14:45:00Z"}
{"id":2,"title":"Pothole repair","description":"Large pothole near the intersection","category":"roads","priority":"high","status":"open","assigned_to":"Public Works","due_date":"2026-03-10","tags":["streets","safety"],"location":{"lat":39.7817,"lng":-89.6501}}
{"items":[{"id":101,"name":"Item one","quantity":2,"price":19.99,"total":39.98},{"id":102,"name":"Item two","quantity":1,"price":5.5,"total":5.5}],"subtotal":45.48,"tax":3.64,"total":49.12,"currency":"USD","paid":false}
{"success":true,"data":[],"error":null,"message":"OK","count":0,"page":1,"per_page":20,"total_pages":1,"enabled":true,"verified":false,"value":null,"version":"1.0.0","url":"https://example.org/","user":{"id":7,"role":"admin"}}
`;
const SDP_CORPUS = 'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:1 1 udp 2113937151 0a1b2c3d-1111-2222-3333-444455556666.local 54321 typ host generation 0 network-cost 999\r\na=ice-ufrag:abcd\r\na=ice-pwd:abcdefghijklmnopqrstuvwx\r\na=ice-options:trickle\r\na=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n';

// ---------- small utilities ----------
class W {
  constructor() { this.b = new Uint8Array(256); this.n = 0; }
  ensure(k) { if (this.n + k > this.b.length) { const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k)); nb.set(this.b); this.b = nb; } }
  u8(x) { this.ensure(1); this.b[this.n++] = x; }
  bytes(a) { this.ensure(a.length); this.b.set(a, this.n); this.n += a.length; }
  varint(x) { while (x >= 128) { this.u8((x % 128) | 128); x = Math.floor(x / 128); } this.u8(x); }
  f64(x) { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, x); this.bytes(new Uint8Array(d.buffer)); }
  done() { return this.b.slice(0, this.n); }
}
class R {
  constructor(b) { this.b = b; this.i = 0; }
  u8() { if (this.i >= this.b.length) throw new Error('Link is truncated'); return this.b[this.i++]; }
  varint() { let x = 0, m = 1, c; do { c = this.u8(); x += (c & 127) * m; m *= 128; if (m > 2 ** 56) throw new Error('Bad number'); } while (c & 128); return x; }
  bytes(n) { if (this.i + n > this.b.length) throw new Error('Link is truncated'); const s = this.b.subarray(this.i, this.i + n); this.i += n; return s; }
  f64() { return new DataView(this.bytes(8).slice().buffer).getFloat64(0); }
  rest() { return this.b.subarray(this.i); }
}
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const fail = (msg, code) => Object.assign(new Error(msg), code ? { code } : {});
const hash8 = s => { let h = 0x811c9dc5; for (const b of te.encode(s)) h = Math.imul(h ^ b, 0x01000193); return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 255; };
let CRC_T;
function crc24(u8) { // low 24 bits of CRC-32: ~4 chars per link, misses 1 damaged link in 16 million
  if (!CRC_T) { CRC_T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; } }
  let c = -1; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) & 0xFFFFFF;
}

// ---------- dictionary: array of words, or { version, words, corpus } (e.g. from loadDictionary) ----------
const normDict = d => !d ? { id: '', words: [], corpus: '' }
  : Array.isArray(d) ? { id: '', words: d.filter(Boolean), corpus: '' }
  : { id: String(d.version ?? ''), words: (d.words || []).filter(Boolean), corpus: d.corpus || '' };
const primeText = D => CORPUS + SDP_CORPUS + D.corpus + '\n' + D.words.join('\n') + '\n\n';
const needsCheck = (fmt, comp) => fmt === PACKD || fmt === SCHEMA || comp === 3;
const checkByte = (fmt, comp, D, S) => {
  const parts = [D.id, D.words.join('\n'), D.corpus, comp === 3 ? CM_VERSION : ''];
  if (fmt === SCHEMA) parts.push(schemaSig(S));
  return hash8(parts.join('\u0001'));
};

/** Load a shared dictionary from a static .json or .toml file shipped with your app. */
export async function loadDictionary(url) {
  const res = await fetch(url); if (!res.ok) throw new Error(`Dictionary ${url}: HTTP ${res.status}`);
  const text = await res.text();
  return /^\s*[{[]/.test(text) ? JSON.parse(text) : parseTomlLite(text);
}
/** Tiny TOML subset: key = "string" | """multi-line""" | ["array", "of", "strings"] | bare value. */
export function parseTomlLite(s) {
  const out = {}, re = /^\s*([A-Za-z_][\w-]*)\s*=\s*("""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|\[[\s\S]*?\]|[^\n#]+)/gm;
  for (const [, k, v] of s.matchAll(re)) {
    out[k] = v.startsWith('"""') ? v.slice(3, -3).replace(/^\r?\n/, '')
      : v.startsWith('[') ? [...v.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`))
      : v.startsWith('"') ? JSON.parse(v) : v.trim();
  }
  return out;
}

// ---------- compression ----------
const nativeOK = {};
export function supports(m) {
  if (m === 'none' || m === 'cm') return true;
  if (m in nativeOK) return nativeOK[m];
  try { new CompressionStream(m); new DecompressionStream(m); return nativeOK[m] = true; } catch { return nativeOK[m] = false; }
}
const pipe = async (b, s) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(s)).arrayBuffer());
const compress = (b, c, D) => c === 0 ? b : c === 3 ? CM.compress(b, primeText(D)) : pipe(b, new CompressionStream(COMP[c]));
function decompress(b, c, D) {
  if (c === 0) return b;
  if (c === 3) return CM.decompress(b, primeText(D));
  if (!supports(COMP[c])) throw new Error(`This browser can't open "${COMP[c]}" links`);
  return pipe(b, new DecompressionStream(COMP[c]));
}

// ---------- "cm": context-mixing compressor, pre-trained on a built-in corpus ----------
// Predicts each bit from several contexts (previous 0-6 bytes, current word, long repeats),
// mixes the predictions, and arithmetic-codes the result. Integer-only math, so every
// browser produces identical predictions (required for decoding).
const CM = (() => {
  const SQ = [1,2,3,6,10,16,27,45,73,120,194,310,488,747,1101,1546,2047,2549,2994,3348,3607,3785,3901,3975,4022,4050,4068,4079,4085,4089,4092,4093,4094];
  const squash = d => { if (d > 2047) return 4095; if (d < -2047) return 1; const w = d & 127, i = (d >> 7) + 16; return (SQ[i] * (128 - w) + SQ[i + 1] * w + 64) >> 7; };
  const STR = new Int16Array(4096);
  { let pi = 0; for (let x = -2047; x <= 2047; x++) { const v = squash(x); for (let i = pi; i <= v; i++) STR[i] = x; pi = v + 1; } for (let i = pi; i < 4096; i++) STR[i] = 2047; }
  const RECIP = new Int32Array(256); for (let n = 0; n < 256; n++) RECIP[n] = Math.floor(131072 / (2 * n + 3));
  const ORDERS = [0, 1, 2, 3, 4, 6], NORD = ORDERS.length + 1, NIN = NORD + 2;
  const BITS = 18, SIZE = 1 << BITS, HBITS = 18, MINLEN = 6, LIMIT = 60, LR = 6;

  class Model {
    constructor(cap) {
      this.P = new Uint16Array(NORD * SIZE).fill(32768); this.N = new Uint8Array(NORD * SIZE);
      this.W = new Int32Array(256 * NIN).fill(19661); this.MP = new Uint16Array(64).fill(32768); this.MN = new Uint8Array(64);
      this.HT = new Int32Array(1 << HBITS); this.hist = new Uint8Array(cap); this.h = new Int32Array(NORD);
      this.pos = 0; this.c0 = 1; this.bk = 0; this.word = 0; this.mptr = 0; this.mlen = 0;
      this.idx = new Int32Array(NORD); this.st = new Int32Array(NIN); this.pr = 2048; this.mi = -1; this.wo = 0;
    }
    clone(extra) {
      const m = Object.create(Model.prototype);
      for (const k of ['P', 'N', 'W', 'MP', 'MN', 'HT', 'h']) m[k] = this[k].slice();
      for (const k of ['pos', 'c0', 'bk', 'word', 'mptr', 'mlen']) m[k] = this[k];
      m.hist = new Uint8Array(this.pos + extra + 1); m.hist.set(this.hist.subarray(0, this.pos));
      m.idx = new Int32Array(NORD); m.st = new Int32Array(NIN); m.pr = 2048; m.mi = -1; m.wo = 0;
      return m;
    }
    predict() {
      const P = this.P, st = this.st, idx = this.idx, h = this.h, c0 = this.c0;
      for (let k = 0; k < NORD; k++) { const j = k * SIZE + (Math.imul(h[k] ^ c0, 0x2545F491) >>> (32 - BITS)); idx[k] = j; st[k] = STR[P[j] >>> 4]; }
      this.mi = -1; st[NORD] = 0;
      if (this.mlen > 0) {
        const eb = this.hist[this.mptr];
        if (((eb | 256) >> (8 - this.bk)) === c0) { this.mi = Math.min(this.mlen, 31) * 2 + ((eb >> (7 - this.bk)) & 1); st[NORD] = STR[this.MP[this.mi] >>> 4]; }
      }
      st[NORD + 1] = 256;
      const W = this.W, wo = this.wo = c0 * NIN;
      let dot = 0; for (let i = 0; i < NIN; i++) dot += st[i] * W[wo + i];
      dot = Math.floor(dot / 65536); if (dot > 2047) dot = 2047; else if (dot < -2047) dot = -2047;
      let p = squash(dot); if (p < 1) p = 1; else if (p > 4095) p = 4095;
      return this.pr = p;
    }
    update(bit) {
      const st = this.st, W = this.W, wo = this.wo, err = ((bit << 12) - this.pr) * LR;
      for (let i = 0; i < NIN; i++) { const w = W[wo + i] + Math.floor(st[i] * err / 65536); W[wo + i] = w > 16777215 ? 16777215 : w < -16777215 ? -16777215 : w; }
      const T = bit ? 65535 : 0, P = this.P, N = this.N, idx = this.idx;
      for (let k = 0; k < NORD; k++) { const j = idx[k], n = N[j]; P[j] += Math.floor((T - P[j]) * RECIP[n] / 65536); if (n < LIMIT) N[j] = n + 1; }
      if (this.mi >= 0) { const j = this.mi, n = this.MN[j]; this.MP[j] += Math.floor((T - this.MP[j]) * RECIP[n] / 65536); if (n < LIMIT) this.MN[j] = n + 1; }
      this.c0 = (this.c0 << 1) | bit;
      if (++this.bk === 8) { this.byte(this.c0 & 255); this.c0 = 1; this.bk = 0; }
    }
    byte(b) {
      const hist = this.hist; hist[this.pos++] = b; const pos = this.pos;
      if (this.mlen > 0 && hist[this.mptr] === b) { this.mlen++; this.mptr++; } else this.mlen = 0;
      if (pos >= MINLEN) {
        let hh = 0; for (let i = pos - MINLEN; i < pos; i++) hh = (Math.imul(hh ^ hist[i], 0x2F0B4AD3) + 1) | 0;
        hh = hh >>> (32 - HBITS);
        if (this.mlen === 0) {
          const cand = this.HT[hh];
          if (cand > 0) { let l = 0; while (l < 32 && cand - 1 - l >= 0 && hist[cand - 1 - l] === hist[pos - 1 - l]) l++; if (l >= MINLEN) { this.mlen = l; this.mptr = cand; } }
        }
        this.HT[hh] = pos;
      }
      const h = this.h;
      for (let k = 0; k < ORDERS.length; k++) {
        let x = Math.imul(k + 1, 0x9E3779B1);
        for (let j = 1; j <= ORDERS[k]; j++) x = (Math.imul(x ^ (pos - j >= 0 ? hist[pos - j] : 0), 0x01000193) + j) | 0;
        h[k] = x;
      }
      const lc = b >= 65 && b <= 90 ? b + 32 : b;
      this.word = (lc >= 97 && lc <= 122) || b >= 128 ? (Math.imul(this.word ^ lc, 0x01000193) + 7) | 0 : 0;
      h[NORD - 1] = this.word === 0 ? Math.imul(0x3C6EF372 ^ b, 0x01000193) | 0 : Math.imul(this.word, 0x2C1B3C6D) | 0;
    }
  }

  const cache = new Map();
  function primed(text) {
    let m = cache.get(text); if (m) return m;
    const bytes = te.encode(text); m = new Model(bytes.length + 1);
    for (const b of bytes) for (let j = 7; j >= 0; j--) { m.predict(); m.update((b >> j) & 1); }
    if (cache.size > 3) cache.clear(); cache.set(text, m);
    return m;
  }
  const mid = (x1, x2, p) => { const r = x2 - x1; return x1 + Math.floor(r / 4096) * p + Math.floor((r % 4096) * p / 4096); };

  function compress(data, prime) {
    const m = primed(prime).clone(data.length), w = new W();
    w.varint(data.length);
    let x1 = 0, x2 = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      for (let j = 7; j >= 0; j--) {
        const bit = (c >> j) & 1, xm = mid(x1, x2, m.predict());
        if (bit) x2 = xm; else x1 = xm + 1;
        m.update(bit);
        while (((x1 ^ x2) & 0xFF000000) === 0) { w.u8(x2 >>> 24); x1 = (x1 << 8) >>> 0; x2 = ((x2 << 8) | 255) >>> 0; }
      }
    }
    w.u8(x1 >>> 24);
    const out = w.done(); let e = out.length;
    while (e > 0 && out[e - 1] === 255) e--; // decoder pads with 0xFF, so trailing 0xFF bytes are free
    return out.slice(0, e);
  }
  function decompress(inp, prime) {
    const r = new R(inp), n = r.varint(), src = r.rest();
    if (n > 16 * 1024 * 1024 || n > (src.length + 16) * 8192) throw new Error('Corrupted link');
    const m = primed(prime).clone(n), out = new Uint8Array(n);
    let ip = 0; const next = () => ip < src.length ? src[ip++] : 255;
    let x1 = 0, x2 = 0xFFFFFFFF, x = 0;
    for (let i = 0; i < 4; i++) x = ((x << 8) | next()) >>> 0;
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let j = 0; j < 8; j++) {
        const xm = mid(x1, x2, m.predict()), bit = x <= xm ? 1 : 0;
        if (bit) x2 = xm; else x1 = xm + 1;
        m.update(bit); c = (c << 1) | bit;
        while (((x1 ^ x2) & 0xFF000000) === 0) { x1 = (x1 << 8) >>> 0; x2 = ((x2 << 8) | 255) >>> 0; x = ((x << 8) | next()) >>> 0; }
      }
      out[i] = c;
    }
    return out;
  }
  return { compress, decompress };
})();

// ---------- smart values: common string shapes stored as numbers/bytes, only when they round-trip exactly ----------
const EPOCH = Date.UTC(2000, 0, 1), DAY = 864e5;
const zz = n => n >= 0 ? n * 2 : -n * 2 - 1, unzz = z => z % 2 ? -(z + 1) / 2 : z / 2;
const dayStr = d => new Date(EPOCH + d * DAY).toISOString().slice(0, 10);
const dayOf = s => { if (!/^\d{4}-\d\d-\d\d$/.test(s)) return null; const d = (Date.parse(s + 'T00:00:00Z') - EPOCH) / DAY; return Number.isInteger(d) && dayStr(d) === s ? d : null; };
const timeStr = (ms, f) => { const i = new Date(EPOCH + ms).toISOString(); return f ? i : i.slice(0, 19) + 'Z'; };
const timeOf = s => { if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/.test(s)) return null; const ms = Date.parse(s) - EPOCH, f = s.length === 24; return Number.isFinite(ms) && timeStr(ms, f) === s ? { ms, f } : null; };
const hexBytes = s => Uint8Array.from(s.match(/../g), h => parseInt(h, 16));
const bytesHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const uuidStr = (b, up) => { const h = bytesHex(b), s = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; return up ? s.toUpperCase() : s; };
const decStr = (abs, sc, neg) => { const t = String(abs).padStart(sc + 1, '0'); return (neg ? '-' : '') + t.slice(0, -sc) + '.' + t.slice(-sc); };
function packSmart(w, s) { // tags 11-18; returns false when the string should be stored as text
  if (s.length < 4 || s.length > 64) return false;
  let d, t, m;
  if ((d = dayOf(s)) !== null) { w.u8(11); w.varint(zz(d)); return true; }
  if ((t = timeOf(s))) { if (t.f) { w.u8(13); w.varint(zz(t.ms)); } else { w.u8(12); w.varint(zz(t.ms / 1000)); } return true; }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    const b = hexBytes(s.replace(/-/g, '')), up = s !== s.toLowerCase();
    if (uuidStr(b, up) === s) { w.u8(up ? 15 : 14); w.bytes(b); return true; }
    return false;
  }
  if (/^(?:[0-9a-f]{2}){4,}$/.test(s)) { w.u8(16); w.varint(s.length / 2); w.bytes(hexBytes(s)); return true; }
  if ((m = /^(-?)(0|[1-9]\d{0,14})$/.exec(s))) { w.u8(17); w.varint(Number(m[2]) * 2 + (m[1] ? 1 : 0)); return true; }
  if ((m = /^(-?)(\d+)\.(\d{1,6})$/.exec(s)) && m[2].length + m[3].length <= 15) {
    const abs = Number(m[2] + m[3]), sc = m[3].length;
    if (decStr(abs, sc, !!m[1]) === s) { w.u8(18); w.varint(abs * 2 + (m[1] ? 1 : 0)); w.u8(sc); return true; }
  }
  return false;
}

// ---------- JSON: binary pack (dedupes strings + object shapes) and columnar text ----------
function pack(value, seed) {
  const w = new W(), strs = new Map(), shapes = new Map();
  for (const s of seed) if (!strs.has(s)) strs.set(s, strs.size);
  const str = s => {
    const i = strs.get(s); if (i !== undefined) { w.u8(7); w.varint(i); return; }
    const b = te.encode(s); w.u8(6); w.varint(b.length); w.bytes(b); if (s.length > 1) strs.set(s, strs.size);
  };
  const val = v => {
    if (v === null) return w.u8(0);
    if (typeof v === 'boolean') return w.u8(v ? 2 : 1);
    if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) <= 2 ** 52) { if (v >= 0 && v < 224) return w.u8(32 + v); if (v >= 0) { w.u8(3); return w.varint(v); } w.u8(4); return w.varint(-v - 1); }
      w.u8(5); return w.f64(v);
    }
    if (typeof v === 'string') return packSmart(w, v) || str(v);
    if (Array.isArray(v)) { w.u8(8); w.varint(v.length); v.forEach(val); return; }
    const keys = Object.keys(v), sk = JSON.stringify(keys), si = shapes.get(sk);
    if (si !== undefined) { w.u8(10); w.varint(si); } else { w.u8(9); w.varint(keys.length); keys.forEach(str); shapes.set(sk, shapes.size); }
    keys.forEach(k => val(v[k]));
  };
  val(value); return w.done();
}
function unpack(bytes, seed) {
  const r = new R(bytes), strs = [], seen = new Set(), shapes = [];
  for (const s of seed) if (!seen.has(s)) { seen.add(s); strs.push(s); }
  const readStr = t => {
    if (t === 7) { const i = r.varint(); if (i >= strs.length) throw new Error('Bad string reference'); return strs[i]; }
    if (t !== 6) throw new Error('Expected a string');
    const s = td.decode(r.bytes(r.varint())); if (s.length > 1) strs.push(s); return s;
  };
  const obj = keys => { const o = {}; for (const k of keys) Object.defineProperty(o, k, { value: val(), enumerable: true, writable: true, configurable: true }); return o; };
  const val = () => {
    const t = r.u8(); if (t >= 32) return t - 32;
    switch (t) {
      case 0: return null; case 1: return false; case 2: return true;
      case 3: return r.varint(); case 4: return -r.varint() - 1; case 5: return r.f64();
      case 6: case 7: return readStr(t);
      case 8: { const n = r.varint(); if (n > r.b.length) throw new Error('Bad array'); const a = []; for (let i = 0; i < n; i++) a.push(val()); return a; }
      case 9: { const n = r.varint(); if (n > r.b.length) throw new Error('Bad object'); const k = []; for (let i = 0; i < n; i++) k.push(readStr(r.u8())); shapes.push(k); return obj(k); }
      case 10: { const k = shapes[r.varint()]; if (!k) throw new Error('Bad shape reference'); return obj(k); }
      case 11: return dayStr(unzz(r.varint()));
      case 12: return timeStr(unzz(r.varint()) * 1000, false);
      case 13: return timeStr(unzz(r.varint()), true);
      case 14: case 15: return uuidStr(r.bytes(16), t === 15);
      case 16: return bytesHex(r.bytes(r.varint()));
      case 17: { const z = r.varint(); return (z % 2 ? '-' : '') + Math.floor(z / 2); }
      case 18: { const z = r.varint(); return decStr(Math.floor(z / 2), r.u8(), z % 2 === 1); }
      default: throw new Error('Bad data');
    }
  };
  const v = val(); if (r.i !== bytes.length) throw new Error('Unexpected trailing data'); return v;
}
const sameKeys = a => {
  if (!Array.isArray(a) || a.length < 2 || !a.every(o => o && typeof o === 'object' && !Array.isArray(o))) return null;
  const k = JSON.stringify(Object.keys(a[0])); return a.every(o => JSON.stringify(Object.keys(o)) === k) ? Object.keys(a[0]) : null;
};
const toCols = v => {
  if (Array.isArray(v)) { const k = sameKeys(v); return k ? { '~c': [k, ...k.map(x => v.map(o => toCols(o[x])))] } : v.map(toCols); }
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = toCols(v[k]); return o; }
  return v;
};
const fromCols = v => {
  if (Array.isArray(v)) return v.map(fromCols);
  if (v && typeof v === 'object') {
    if (Object.keys(v).length === 1 && Array.isArray(v['~c'])) {
      const [keys, ...cols] = v['~c'], n = cols.length ? cols[0].length : 0;
      return Array.from({ length: n }, (_, i) => { const o = {}; keys.forEach((k, j) => o[k] = fromCols(cols[j][i])); return o; });
    }
    const o = {}; for (const k in v) o[k] = fromCols(v[k]); return o;
  }
  return v;
};

// ---------- text encodings ----------
const A80 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&()*+,;=:@/?';
const A80_IDX = Object.fromEntries([...A80].map((c, i) => [c, i])), BLK = 15;
const B80_LEN = Array.from({ length: BLK + 1 }, (_, m) => { let c = 0; while (80n ** BigInt(c) < 256n ** BigInt(m)) c++; return c; });
const B80_BYTES = Object.fromEntries(B80_LEN.map((c, m) => [c, m]));
function toB80(u8) {
  let out = '';
  for (let i = 0; i < u8.length; i += BLK) {
    const blk = u8.subarray(i, i + BLK); let n = 0n, s = '';
    for (const x of blk) n = (n << 8n) | BigInt(x);
    for (let k = 0; k < B80_LEN[blk.length]; k++) { s = A80[Number(n % 80n)] + s; n /= 80n; }
    out += s;
  }
  return out;
}
function fromB80(str) {
  const L = B80_LEN[BLK], rest = str.length % L;
  if (rest && B80_BYTES[rest] === undefined) throw new Error('Link has the wrong length (was it cut off?)');
  const out = new Uint8Array(Math.floor(str.length / L) * BLK + (rest ? B80_BYTES[rest] : 0));
  for (let i = 0, o = 0; i < str.length;) {
    const c = Math.min(L, str.length - i), m = B80_BYTES[c]; let n = 0n;
    for (let k = 0; k < c; k++) { const d = A80_IDX[str[i + k]]; if (d === undefined) throw new Error('Bad characters in link'); n = n * 80n + BigInt(d); }
    if (n >> BigInt(8 * m)) throw new Error('Corrupted link');
    for (let k = m - 1; k >= 0; k--) { out[o + k] = Number(n & 255n); n >>= 8n; }
    o += m; i += c;
  }
  return out;
}
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64(s) { if (/[^\w-]/.test(s)) throw new Error('Bad characters in link'); s = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)); }
const ENC = { a: [toB64, fromB64], b: [toB80, fromB80] };
const encLen = { a: n => 1 + Math.ceil(n * 4 / 3), b: n => 1 + Math.floor(n / BLK) * B80_LEN[BLK] + B80_LEN[n % BLK] };

// ---------- encryption: AES-GCM with a password (PBKDF2) or a random split key ----------
async function aesKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const rawKey = bytes => crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);

// ---------- schema mode: records bit-packed against a schema both sides know ----------
const SCHEMA_TYPES = ['enum', 'bool', 'int', 'number', 'date', 'datetime', 'text'];
/**
 * Validate a schema. Fields: { name, type, required?, values? (enum), min?/max? (int), decimals? (number) }
 * Types: enum | bool | int | number | date ("YYYY-MM-DD") | datetime (ISO "...Z") | text
 */
export function defineSchema(def) {
  if (!def || !Array.isArray(def.fields) || !def.fields.length) throw new Error('Schema needs fields');
  const seen = new Set();
  for (const f of def.fields) {
    if (!f.name || f.name === '__proto__' || seen.has(f.name)) throw new Error(`Bad or repeated field name: ${f.name}`);
    seen.add(f.name);
    if (!SCHEMA_TYPES.includes(f.type)) throw new Error(`Unknown type "${f.type}" for ${f.name}`);
    if (f.type === 'enum' && !(Array.isArray(f.values) && f.values.length)) throw new Error(`Enum ${f.name} needs values`);
    if (f.type === 'int' && (f.min != null) !== (f.max != null)) throw new Error(`Int ${f.name}: give both min and max, or neither`);
  }
  return def;
}
const bitsFor = n => { let b = 0; while (2 ** b < n) b++; return b; };
const schemaSig = S => JSON.stringify([S.id ?? '', S.version ?? '', S.fields]);
class BW {
  constructor() { this.w = new W(); this.a = 0; this.n = 0; }
  bits(v, k) { for (let i = k - 1; i >= 0; i--) { this.a = this.a << 1 | Math.floor(v / 2 ** i) % 2; if (++this.n === 8) { this.w.u8(this.a); this.a = this.n = 0; } } }
  varint(v) { while (v >= 128) { this.bits(v % 128 + 128, 8); v = Math.floor(v / 128); } this.bits(v, 8); }
  finish() { if (this.n) this.w.u8(this.a << (8 - this.n)); this.a = this.n = 0; return this.w; }
}
class BR {
  constructor(b) { this.b = b; this.p = 0; }
  bits(k) { let v = 0; for (let i = 0; i < k; i++, this.p++) { const x = this.b[this.p >> 3]; if (x === undefined) throw new Error('Link is truncated'); v = v * 2 + (x >> (7 - (this.p & 7)) & 1); } return v; }
  varint() { let x = 0, m = 1, c; do { c = this.bits(8); x += (c & 127) * m; m *= 128; if (m > 2 ** 56) throw new Error('Bad number'); } while (c & 128); return x; }
}
function packSchema(obj, S) { // throws Error(reason) when the record doesn't fit
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object');
  const names = new Set(S.fields.map(f => f.name));
  for (const k of Object.keys(obj)) if (!names.has(k)) throw new Error(`unknown field "${k}"`);
  const bw = new BW(), texts = [];
  for (const f of S.fields) {
    const v = obj[f.name], present = v != null, bad = () => new Error(`"${f.name}" doesn't fit ${f.type}`);
    if (f.required && !present) throw new Error(`"${f.name}" is required`);
    if (!f.required) bw.bits(present ? 1 : 0, 1);
    if (!present) continue;
    switch (f.type) {
      case 'enum': { const i = f.values.indexOf(v); if (i < 0) throw bad(); bw.bits(i, bitsFor(f.values.length)); break; }
      case 'bool': if (typeof v !== 'boolean') throw bad(); bw.bits(+v, 1); break;
      case 'int':
        if (!Number.isSafeInteger(v)) throw bad();
        if (f.min != null) { if (v < f.min || v > f.max) throw bad(); bw.bits(v - f.min, bitsFor(f.max - f.min + 1)); } else bw.varint(zz(v));
        break;
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw bad();
        if (f.decimals != null) { const m = Math.round(v * 10 ** f.decimals); if (!Number.isSafeInteger(m) || m / 10 ** f.decimals !== v) throw bad(); bw.varint(zz(m)); }
        else { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v); for (let i = 0; i < 8; i++) bw.bits(d.getUint8(i), 8); }
        break;
      }
      case 'date': { const d = typeof v === 'string' ? dayOf(v) : null; if (d === null) throw bad(); bw.varint(zz(d)); break; }
      case 'datetime': { const t = typeof v === 'string' && timeOf(v); if (!t) throw bad(); bw.bits(+t.f, 1); bw.varint(zz(t.f ? t.ms : t.ms / 1000)); break; }
      default: if (typeof v !== 'string') throw bad(); texts.push(v);
    }
  }
  const w = bw.finish();
  for (const s of texts) { const b = te.encode(s); w.varint(b.length); w.bytes(b); }
  return w.done();
}
function unpackSchema(bytes, S) {
  const br = new BR(bytes), out = {}, textFields = [];
  for (const f of S.fields) {
    if (!f.required && !br.bits(1)) { out[f.name] = null; continue; }
    switch (f.type) {
      case 'enum': { const i = br.bits(bitsFor(f.values.length)); if (i >= f.values.length) throw new Error('Corrupted link'); out[f.name] = f.values[i]; break; }
      case 'bool': out[f.name] = br.bits(1) === 1; break;
      case 'int': out[f.name] = f.min != null ? f.min + br.bits(bitsFor(f.max - f.min + 1)) : unzz(br.varint()); break;
      case 'number':
        if (f.decimals != null) out[f.name] = unzz(br.varint()) / 10 ** f.decimals;
        else { const d = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) d.setUint8(i, br.bits(8)); out[f.name] = d.getFloat64(0); }
        break;
      case 'date': out[f.name] = dayStr(unzz(br.varint())); break;
      case 'datetime': { const ms = br.bits(1), v = unzz(br.varint()); out[f.name] = ms ? timeStr(v, true) : timeStr(v * 1000, false); break; }
      default: out[f.name] = ''; textFields.push(f.name); // keeps schema key order; filled below
    }
  }
  const r = new R(bytes); r.i = Math.ceil(br.p / 8);
  for (const n of textFields) out[n] = td.decode(r.bytes(r.varint()));
  if (r.i !== bytes.length) throw new Error('Unexpected trailing data');
  return out;
}
const schemaShape = (obj, S) => Object.fromEntries(S.fields.map(f => [f.name, obj?.[f.name] ?? null]));

// ---------- container ----------
// [flags: comp(2) fmt(3) encrypted(1) version(2; 3 = split-key)] [check byte?] [crc24 if not encrypted]
// [body | password: salt16 iv12 ciphertext | split key: iv12 ciphertext]
async function payloads(input, D, S) {
  if (input instanceof Uint8Array) input = new File([input], 'data.bin', { type: 'application/octet-stream' });
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const w = new W(), n = te.encode(input.name || ''), t = te.encode(input.type || '');
    w.varint(n.length); w.bytes(n); w.varint(t.length); w.bytes(t); w.bytes(new Uint8Array(await input.arrayBuffer()));
    return { kind: 'file', list: [{ fmt: FILE, data: w.done() }] };
  }
  let value, json = false;
  if (typeof input === 'string') { if (/^\s*[[{]/.test(input)) try { value = JSON.parse(input); json = true; } catch {} }
  else { value = JSON.parse(JSON.stringify(input ?? null)); json = true; }
  if (!json) return { kind: 'text', value: String(input), list: [{ fmt: TEXT, data: te.encode(String(input)) }] };
  const s = JSON.stringify(value), list = [{ fmt: JSONF, data: te.encode(s) }, { fmt: PACK, data: pack(value, []) }];
  if (!s.includes('"~c"')) { const c = JSON.stringify(toCols(value)); if (c !== s) list.push({ fmt: COLS, data: te.encode(c) }); }
  if (D.words.length) list.push({ fmt: PACKD, data: pack(value, D.words) });
  let schemaFallback;
  if (S) try { list.unshift({ fmt: SCHEMA, data: packSchema(value, S) }); } catch (e) { schemaFallback = e.message; }
  return { kind: 'json', value: s, obj: value, list, schemaFallback };
}
const head = (fmt, comp, enc, D, S, ver = VERSION) => {
  const f = comp | fmt << 2 | (enc ? 32 : 0) | ver << 6;
  return new Uint8Array(needsCheck(fmt, comp) ? [f, checkByte(fmt, comp, D, S)] : [f]);
};

/**
 * Encode anything into a link fragment.
 * input: string | JSON-able value | File/Blob | Uint8Array
 * opts:  { password | splitKey: true, dict, schema, encoding: 'b' (base80, shortest) | 'a' (base64url, chat-safe), verify: true }
 * splitKey: encrypts with a random key returned as result.key (22 chars); send it separately from the link.
 */
export async function encode(input, opts = {}) {
  const D = normDict(opts.dict), S = opts.schema ? defineSchema(opts.schema) : null;
  const encoding = opts.encoding || 'b', password = opts.password || '';
  if (!ENC[encoding]) throw new Error('Unknown encoding');
  if (password && opts.splitKey) throw new Error('Use either password or splitKey, not both');
  const { kind, value, obj, list, schemaFallback } = await payloads(input, D, S);
  const cands = [];
  const add = async (p, comp) => { const body = await compress(p.data, comp, D); cands.push({ p, comp, body, bytes: head(p.fmt, comp, false, D, S).length + 3 + body.length }); };
  // 1) fast native compressors on every format
  for (const p of list) for (const c of [0, 1, 2]) if (supports(COMP[c])) await add(p, c);
  // 2) the smart (slower) compressor only on the most promising formats, and only if data looks compressible
  const bestBy = new Map(); for (const c of cands) bestBy.set(c.p, Math.min(bestBy.get(c.p) ?? Infinity, c.bytes));
  const top = new Set([...bestBy].sort((a, b) => a[1] - b[1]).slice(0, 2).map(x => x[0]));
  const plain = list.find(p => p.fmt === TEXT || p.fmt === JSONF); if (plain) top.add(plain); // plain text/JSON is often the best input for cm
  for (const p of top) {
    const deflated = cands.find(c => c.p === p && c.comp === 1)?.body.length ?? p.data.length;
    if (p.data.length <= CM_MAX && !(kind === 'file' && deflated > p.data.length * 0.97)) await add(p, 3);
  }
  cands.sort((a, b) => a.bytes - b.bytes);
  const best = cands[0], { fmt } = best.p;
  let container, key;
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), h = head(fmt, best.comp, true, D, S);
    container = concat(h, salt, iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: h }, await aesKey(password, salt), best.body)));
  } else if (opts.splitKey) {
    const k = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), h = head(fmt, best.comp, true, D, S, 3);
    container = concat(h, iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: h }, await rawKey(k), best.body)));
    key = toB64(k);
  } else {
    const c = crc24(best.p.data);
    container = concat(head(fmt, best.comp, false, D, S), new Uint8Array([c >> 16, c >> 8 & 255, c & 255]), best.body);
  }
  const fragment = encoding + ENC[encoding][0](container);
  let verified = null;
  if (opts.verify !== false) {
    try {
      const back = await decode(container, { ...opts, key });
      const d = best.p.data, tail = d.subarray(d.length - back.value.length);
      verified = kind === 'file' ? back.value.length === tail.length && crc24(back.value) === crc24(tail)
        : kind === 'text' ? back.value === value
        : JSON.stringify(back.value) === (fmt === SCHEMA ? JSON.stringify(schemaShape(obj, S)) : value);
    } catch { verified = false; }
  }
  return {
    fragment, container, kind, format: FMT[fmt], compression: COMP[best.comp], encrypted: !!(password || key), verified,
    chars: fragment.length, bytes: container.length, ...(key && { key }), ...(schemaFallback && { schemaFallback }),
    candidates: cands.map(c => ({ format: FMT[c.p.fmt], compression: COMP[c.comp], bytes: c.bytes, chars: { a: encLen.a(c.bytes), b: encLen.b(c.bytes) } })),
  };
}

/**
 * Decode a link, "#fragment", bare fragment, multi-part link, or a container (Uint8Array).
 * opts: { password, key, dict, schema }
 * Returns { kind: 'text'|'json'|'file', value, name?, type?, format, compression, encrypted }.
 * Error codes: 'PASSWORD' | 'KEY' (missing/wrong secret), 'DICT' (dictionary/schema/version mismatch),
 *              'SCHEMA' (schema not supplied), 'PART' (multi-part link; err.parts = { have, total, missing }).
 */
export async function decode(src, opts = {}) {
  const D = normDict(opts.dict), S = opts.schema || null;
  let bytes = src;
  if (typeof src === 'string') {
    let f = fragmentOf(src);
    try { f = decodeURIComponent(f); } catch {}
    if (!f) throw new Error('Empty link');
    if (f[0] === 'p') {
      const p = collectPart(f);
      if (!p.complete) throw Object.assign(fail(`Got part ${p.have} of ${p.total}`, 'PART'), { parts: p });
      bytes = p.container;
    } else {
      if (!ENC[f[0]]) throw new Error('Not a FragmentDB link');
      bytes = ENC[f[0]][1](f.slice(1));
    }
  }
  const r = new R(bytes), flags = r.u8(), comp = flags & 3, fmt = flags >> 2 & 7, enc = !!(flags & 32), ver = flags >> 6;
  if (ver < VERSION || (ver === 3 && !enc)) throw new Error('Link was made by a different version');
  if (fmt > SCHEMA) throw new Error('Corrupted link');
  if (fmt === SCHEMA && !S) throw fail('This link needs its schema to open', 'SCHEMA');
  if (needsCheck(fmt, comp) && r.u8() !== checkByte(fmt, comp, D, S)) throw fail('Link needs a different dictionary, schema or app version', 'DICT');
  const h = bytes.subarray(0, r.i);
  const crc = enc ? null : (r.u8() << 16) | (r.u8() << 8) | r.u8();
  let body = r.rest();
  if (enc && ver === 3) {
    if (!opts.key) throw fail('This link needs its key', 'KEY');
    let k; try { k = fromB64(String(opts.key).trim()); } catch { k = null; }
    if (!k || k.length !== 16) throw fail('That key is not valid', 'KEY');
    if (body.length < 28) throw new Error('Link is truncated');
    try { body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(0, 12), additionalData: h }, await rawKey(k), body.subarray(12))); }
    catch { throw fail('Wrong key or damaged link', 'KEY'); }
  } else if (enc) {
    if (!opts.password) throw fail('Password required', 'PASSWORD');
    if (body.length < 44) throw new Error('Link is truncated');
    try { body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(16, 28), additionalData: h }, await aesKey(opts.password, body.subarray(0, 16)), body.subarray(28))); }
    catch { throw fail('Wrong password or damaged link', 'PASSWORD'); }
  }
  const raw = await decompress(body, comp, D);
  if (crc !== null && crc24(raw) !== crc) throw new Error('Link is damaged (checksum mismatch)');
  const meta = { format: FMT[fmt], compression: COMP[comp], encrypted: enc };
  switch (fmt) {
    case TEXT: return { kind: 'text', value: td.decode(raw), ...meta };
    case JSONF: return { kind: 'json', value: JSON.parse(td.decode(raw)), ...meta };
    case COLS: return { kind: 'json', value: fromCols(JSON.parse(td.decode(raw))), ...meta };
    case PACK: return { kind: 'json', value: unpack(raw, []), ...meta };
    case PACKD: return { kind: 'json', value: unpack(raw, D.words), ...meta };
    case SCHEMA: return { kind: 'json', value: unpackSchema(raw, S), ...meta };
    default: { const f = new R(raw), name = td.decode(f.bytes(f.varint())), type = td.decode(f.bytes(f.varint())); return { kind: 'file', value: f.rest().slice(), name, type, ...meta }; }
  }
}

// ---------- links, files, sharing (browser only) ----------
// URL.parse is newer (2024); fall back to the constructor so older browsers still work.
const toURL = (s, base) => { try { return URL.parse ? URL.parse(s, base) : new URL(s, base); } catch { return null; } };
/** Accepts a full link, a relative link, "#fragment" or a bare fragment, and returns the fragment. */
function fragmentOf(src) {
  src = src.trim();
  if (!src.includes('#')) { // bare fragment (never contains '#'), or a URL that has no data in it
    if (/^[a-z][\w+.-]*:\/\//i.test(src) && toURL(src)) throw new Error('This link has no data (#fragment missing)');
    return src;
  }
  const u = toURL(src, 'https://fragmentdb.invalid/');
  if (!u) throw new Error('Not a valid link');
  return u.hash.slice(1);
}
/** Full link for a result: `base` (default: current page) with its #fragment replaced. */
export function linkFor(result, base = globalThis.location?.href) {
  const u = toURL(base); if (!u) throw new Error('linkFor needs a valid base URL');
  u.hash = result.fragment; // base80/base64url characters pass through the URL serializer unchanged
  return u.href;
}
/** Save into the current URL without adding a history entry. */
export async function save(input, opts) { const r = await encode(input, opts); history.replaceState(history.state, '', linkFor(r)); return r; }
export const load = opts => location.hash.length > 1 ? decode(location.hash, opts) : Promise.resolve(null);

// ---------- multi-part links: split long data across several links, reassembled on the receiving device ----------
/**
 * Like encode(), plus result.parts: fragments of at most `maxChars` characters each (default 1800,
 * which keeps full links under ~2000 for chat apps). Open them in any order; the last one decodes.
 */
export async function encodeParts(input, { maxChars = 1800, ...opts } = {}) {
  const r = await encode(input, opts), enc = opts.encoding || 'b';
  if (r.chars <= maxChars) return { ...r, parts: [r.fragment] };
  const c = r.container, id = crc24(c), per = Math.max(16, Math.floor((maxChars - 12) * (enc === 'b' ? 15 / 19 : 3 / 4)));
  const total = Math.ceil(c.length / per), parts = [];
  for (let i = 0; i < total; i++) {
    const w = new W(); w.bytes([id >> 16, id >> 8 & 255, id & 255]); w.varint(i); w.varint(total); w.bytes(c.subarray(i * per, (i + 1) * per));
    parts.push('p' + enc + ENC[enc][0](w.done()));
  }
  return { ...r, parts };
}
const mem = new Map(), PREFIX = 'fdb-part:', WEEK = 7 * DAY;
const store = { // localStorage when available (parts arrive as separate page loads), memory otherwise
  get: k => { if (mem.has(k)) return mem.get(k); try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem.set(k, v); } },
  del: k => { mem.delete(k); try { localStorage.removeItem(k); } catch {} },
  prune() { try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(PREFIX) && Date.now() - (this.get(k)?.t ?? 0) > WEEK) this.del(k); } } catch {} },
};
export const isPart = src => { try { return fragmentOf(String(src)).startsWith('p'); } catch { return false; } };
/** Store one part; returns { complete, have, total, missing (1-based), container? }. */
export function collectPart(src) {
  let f = fragmentOf(String(src)); try { f = decodeURIComponent(f); } catch {}
  if (f[0] !== 'p' || !ENC[f[1]]) throw new Error('Not a multi-part link');
  const r = new R(ENC[f[1]][1](f.slice(2))), id = r.u8() << 16 | r.u8() << 8 | r.u8(), i = r.varint(), total = r.varint();
  if (!(total >= 1 && total <= 10000 && i < total)) throw new Error('Corrupted part');
  store.prune();
  const key = PREFIX + id.toString(36) + '.' + total, rec = store.get(key) || { t: Date.now(), p: {} };
  rec.p[i] = toB64(r.rest()); store.set(key, rec);
  const missing = []; for (let k = 0; k < total; k++) if (!(k in rec.p)) missing.push(k + 1);
  const have = total - missing.length;
  if (missing.length) return { complete: false, have, total, missing };
  const container = concat(...Array.from({ length: total }, (_, k) => fromB64(rec.p[k])));
  store.del(key);
  if (crc24(container) !== id) throw new Error("Parts don't belong together (checksum mismatch)");
  return { complete: true, have, total, missing, container };
}

/** .fdb file: compact binary form of a link, for data too big for a URL. */
export const toFile = (result, name = 'shared-data.fdb') => new File([MAGIC, result.container], name, { type: 'application/octet-stream' });
export async function readFdb(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  if (b.length < 5 || MAGIC.some((x, i) => b[i] !== x)) throw new Error('Not a .fdb file');
  return b.subarray(MAGIC.length);
}
export const fromFile = async (file, opts) => decode(await readFdb(file), opts);
export function download(file) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/**
 * Smart share: short links go through the OS share sheet (or clipboard);
 * data too long for a link is shared as a .fdb file (AirDrop, Nearby Share, email...) or downloaded.
 * Returns 'shared-link' | 'copied-link' | 'shared-file' | 'downloaded-file' | 'cancelled'.
 */
export async function share(result, { title = 'Shared data', linkMax = 8000, base } = {}) {
  const url = linkFor(result, base);
  const tryShare = async data => { try { await navigator.share(data); return true; } catch (e) { if (e.name === 'AbortError') throw e; return false; } };
  try {
    if (url.length <= linkMax) {
      if (navigator.share && await tryShare({ title, url })) return 'shared-link';
      await navigator.clipboard.writeText(url); return 'copied-link';
    }
    const file = toFile(result);
    if (navigator.canShare?.({ files: [file] }) && await tryShare({ title, files: [file] })) return 'shared-file';
    download(file); return 'downloaded-file';
  } catch (e) { if (e.name === 'AbortError') return 'cancelled'; throw e; }
}

/** Web NFC (Android Chrome only). Typical stickers hold 140-880 bytes, so only short links fit. */
export const nfc = {
  supported: () => typeof window !== 'undefined' && 'NDEFReader' in window,
  write: url => new NDEFReader().write({ records: [{ recordType: 'url', data: url }] }),
  async read(onUrl, signal) {
    const r = new NDEFReader(); await r.scan({ signal });
    r.onreading = e => { for (const rec of e.message.records) if (rec.recordType === 'url') onUrl(td.decode(rec.data)); };
  },
};

// ---------- postMessage RPC: run the codec in a Worker or an iframe ----------
/** Call inside a Worker (serve(self)) or an embedded page (serve(window, { origins: [...] })). */
export function serve(scope = globalThis, { origins } = {}) {
  const onMsg = async e => {
    const m = e.data; if (!m || typeof m.fdb !== 'string' || m.id == null) return;
    if (origins && e.origin && !origins.includes(e.origin)) return;
    const reply = msg => e.source && e.source.postMessage ? e.source.postMessage(msg, e.origin || '*') : scope.postMessage(msg);
    try {
      const fn = { encode, decode, encodeParts }[m.fdb]; if (!fn) throw new Error('Unknown call');
      reply({ fdbId: m.id, ok: true, result: await fn(m.input, m.opts) });
    } catch (err) { reply({ fdbId: m.id, ok: false, message: err.message, code: err.code, parts: err.parts }); }
  };
  scope.addEventListener('message', onMsg);
  return () => scope.removeEventListener('message', onMsg);
}
/** Same API as this module ({ encode, decode }) but runs in a Worker or an iframe window. */
export function client(target, origin = '*') {
  const isWorker = typeof Worker !== 'undefined' && target instanceof Worker;
  const listen = isWorker ? target : window, pending = new Map(); let n = 0;
  listen.addEventListener('message', e => {
    const m = e.data; if (!m || m.fdbId == null || (!isWorker && e.source !== target)) return;
    const p = pending.get(m.fdbId); if (!p) return; pending.delete(m.fdbId);
    m.ok ? p.resolve(m.result) : p.reject(Object.assign(fail(m.message, m.code), m.parts && { parts: m.parts }));
  });
  const call = fdb => (input, opts) => new Promise((resolve, reject) => {
    const id = ++n; pending.set(id, { resolve, reject });
    isWorker ? target.postMessage({ fdb, id, input, opts }) : target.postMessage({ fdb, id, input, opts }, origin);
  });
  return { encode: call('encode'), decode: call('decode'), encodeParts: call('encodeParts') };
}
