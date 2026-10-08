# FragmentDB (React)

Store any data (text, JSON or files) in a URL `#fragment`. No server, no third parties, no dependencies.

## Files

| File | What it is |
|---|---|
| `src/fragmentdb.js` | The engine. Plain ES module; works in React, plain JS, Workers and Node 18+. About 11 KB gzipped. |
| `src/hooks.js` | React hooks: `useFragmentDB`, `useLanTransfer` |
| `src/lan.js` | `LanTransfer`: same-network WebRTC transfer, any size, no signaling/STUN/TURN servers |
| `src/fdb.worker.js` | Runs the engine off the main thread (via postMessage) |
| `public/fdb-dict.toml` | Example shared dictionary (static file shipped with your app) |
| `src/schemas.js` | Example schema (work order) for schema mode |
| `src/App.jsx`, `src/main.jsx`, `public/index.html` | Demo app |

Run the demo: `npm install && bash build.sh && npx serve dist` (any static server works).

## Use in React

```jsx
import { useFragmentDB } from './fragmentdb/hooks.js';
import { client, loadDictionary } from './fragmentdb/fragmentdb.js';

const worker = client(new Worker(new URL('./fragmentdb/fdb.worker.js', import.meta.url), { type: 'module' }));

function Report() {
  const db = useFragmentDB({ codec: worker /*, dict */ });
  // db.data -> what the current link holds; db.status === 'locked' -> ask for a password, then db.unlock(pw)
  return <>
    <button onClick={() => db.save({ ticket: 4512, status: 'pending' }, { password: '' })}>Save</button>
    <button onClick={() => db.share()}>Share</button>   {/* link via share sheet/clipboard; big data -> .fdb file */}
    <pre>{JSON.stringify(db.data?.value, null, 2)}</pre>
  </>;
}
```

## Use without React

```js
import { encode, decode, save, load, share, toFile, fromFile } from './fragmentdb.js';
const r = await encode(anything, { password, dict, encoding: 'b' }); // r.fragment, r.chars, r.container
const { kind, value } = await decode(location.href, { password, dict });
```

## Schema mode, split keys and multi-part links

```js
import { WORK_ORDER } from './schemas.js';

// Schema mode: only the values go in the link, bit-packed (a work order: 113 -> 62 chars).
// Records that don't fit (unknown field, value out of range...) silently fall back to normal
// encoding; result.schemaFallback says why. Decoded records list every field (absent = null).
const r = await encode(record, { schema: WORK_ORDER });
const { value } = await decode(link, { schema: WORK_ORDER });

// Split key: the link holds encrypted data, result.key (22 chars) travels separately (e.g. by text message).
const s = await encode(record, { splitKey: true });   // s.fragment + s.key
await decode(link, { key: s.key });                    // err.code === 'KEY' if missing or wrong

// Multi-part links: for chat apps that cut long messages. Open the parts in any order on one device.
const m = await encodeParts(bigData, { maxChars: 1800 }); // m.parts = [fragment, ...]
// decode() throws err.code === 'PART' with err.parts = { have, total, missing } until the last part arrives.
```

In React: `useFragmentDB({ schema })`, `db.save(input, { splitKey: true })`, `db.saveParts(input, { maxChars })`,
`db.links` (one per part), `db.status === 'collecting'` with `db.parts`, `db.unlock(passwordOrKey)`.

Schema field types: `enum` (values), `bool`, `int` (optional min/max), `number` (optional decimals),
`date` ("YYYY-MM-DD"), `datetime` (ISO, ending in "Z"), `text`. Mark fields `required: true` to save a bit each.
**Bump the schema `version` whenever you change it**, because links depend on it.

## Features

- **Smallest result picked automatically:** text, JSON, columnar JSON, binary pack, schema, file × none / deflate-raw / brotli (if the browser has it) / `cm`
- **Smart values:** inside any JSON, dates, ISO timestamps, UUIDs, hex strings and numbers stored as text are kept as compact numbers or bytes, only when they convert back exactly (so `"004512"` stays text)
- **`cm`:** a pre-trained context-mixing compressor, 30–50% smaller than deflate on short text
- **Checks:** a CRC-24 catches damaged links (they error, never return wrong data); a check byte detects dictionary or version mismatches (`err.code === 'DICT'`)
- **Optional password:** AES-256-GCM (`err.code === 'PASSWORD'`), or a **split key** (AES-128-GCM random key sent separately)
- **Shared dictionary:** `loadDictionary('/fdb-dict.toml' | '.json')`. Bump `version` whenever you change it, because links depend on it
- **Smart share:** links go through the Web Share API, falling back to the clipboard; data too long for a link goes as a `.fdb` file, falling back to a download
- **`.fdb` files:** `toFile(result)` and `fromFile(file)`, in compact binary
- **Web NFC (Android Chrome):** `nfc.write(link)` and `nfc.read(cb)`. Stickers hold about 140–880 bytes
- **postMessage RPC:** `serve(self)` in a Worker, or `serve(window, { origins })` in an iframe, with `client(target)` for the same API
- **Same-network transfer:** `useLanTransfer()` or `LanTransfer`

## Limits

- Link length grows with the data. Short `bit.ly`-style links are impossible without storage.
- Same-network transfer needs both devices on one network that allows multicast DNS. Guest Wi-Fi with "client isolation" blocks it.
- If you change `CORPUS` in the engine, bump `CM_VERSION`.
