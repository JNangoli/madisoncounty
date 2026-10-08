import { useEffect, useMemo, useState } from 'react';
import * as FDB from './fragmentdb.js';
import { useFragmentDB, useLanTransfer } from './hooks.js';
import { WORK_ORDER, SAMPLE_WORK_ORDER } from './schemas.js';

const fmt = n => n.toLocaleString();
const tier = n => n <= FDB.LINK_SAFE ? ['ok', 'safe anywhere'] : n <= 8000 ? ['warn', 'may break in some chat apps'] : ['bad', 'too long to share as a link: use Share (sends a .fdb file)'];

function DataView({ data }) {
  const url = useMemo(() => data?.kind === 'file' ? URL.createObjectURL(new Blob([data.value], { type: data.type })) : null, [data]);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  if (!data) return null;
  if (data.kind !== 'file') return <pre className="box">{data.kind === 'json' ? JSON.stringify(data.value, null, 2) : data.value}</pre>;
  return <p><a href={url} download={data.name}>Download {data.name} ({fmt(data.value.length)} bytes)</a>
    {data.type?.startsWith('image/') && <img src={url} alt={data.name} className="preview" />}</p>;
}

export default function App() {
  const [dict, setDict] = useState(null);
  const [useWorker, setUseWorker] = useState(true);
  const [text, setText] = useState(JSON.stringify(SAMPLE_WORK_ORDER, null, 2));
  const [useSchema, setUseSchema] = useState(true);
  const [protect, setProtect] = useState('none');
  const [maxChars, setMaxChars] = useState(300);
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [encoding, setEncoding] = useState('b');
  const [unlockPw, setUnlockPw] = useState('');
  const [msg, setMsg] = useState('');
  const [peerCode, setPeerCode] = useState('');

  useEffect(() => { FDB.loadDictionary('./fdb-dict.toml').then(setDict, () => setDict([])); }, []);
  // Worker keeps the UI responsive for big inputs. With Vite/webpack use: new Worker(new URL('./fdb.worker.js', import.meta.url), { type: 'module' })
  const codec = useMemo(() => useWorker && typeof Worker !== 'undefined' ? FDB.client(new Worker('./fdb.worker.js', { type: 'module' })) : FDB, [useWorker]);
  const db = useFragmentDB({ dict, schema: useSchema ? WORK_ORDER : undefined, codec, autoLoad: dict !== null });
  const lan = useLanTransfer({ dict });
  const input = file ?? text;
  const secretOpts = { encoding, ...(protect === 'password' && { password }), ...(protect === 'key' && { splitKey: true }) };

const SHARE_MSG = { 'shared-link': 'Link shared.', 'copied-link': 'Link copied to clipboard.', 'shared-file': 'Shared as a .fdb file (too long for a link).', 'downloaded-file': 'Too long for a link: downloaded as a .fdb file instead.', cancelled: 'Share cancelled.' };
  const run = async (label, fn) => { setMsg(''); try { const r = await fn(); setMsg(SHARE_MSG[r] || (typeof r === 'string' ? r : label)); } catch (e) { setMsg('Error: ' + e.message); } };
  const [cls, note] = db.result ? tier(db.link.length) : [];

  return (
    <main>
      <h1>FragmentDB</h1>
      <p className="muted">Data lives in the link. No server, no third parties.</p>

      {(db.data || ['locked', 'error', 'collecting'].includes(db.status)) && (
        <section>
          <h2>Data from this link</h2>
          {db.status === 'collecting' && <p>Received part {db.parts.have} of {db.parts.total}. Open the other link{db.parts.missing.length > 1 ? 's' : ''} (part {db.parts.missing.join(', ')}) on this device.</p>}
          {db.status === 'locked' && <div className="row">
            <input type="password" placeholder={db.error?.code === 'KEY' ? 'Key (sent to you separately)' : 'Password'} value={unlockPw} onChange={e => setUnlockPw(e.target.value)} aria-label="Password to unlock" />
            <button onClick={() => db.unlock(unlockPw)}>Unlock</button></div>}
          {(db.status === 'error' || (db.status === 'locked' && db.error && unlockPw)) && <p className="bad">{db.error?.message}</p>}
          {db.data && <p className="muted">{db.data.kind} · {db.data.format} · {db.data.compression}{db.data.encrypted ? ' · encrypted' : ''}</p>}
          <DataView data={db.data} />
        </section>
      )}

      <section>
        <h2>Create a link</h2>
        <textarea value={text} onChange={e => { setText(e.target.value); setFile(null); }} disabled={!!file} aria-label="Text or JSON" />
        <div className="row">
          <label>File <input type="file" onChange={e => setFile(e.target.files[0] || null)} /></label>
          <select value={protect} onChange={e => setProtect(e.target.value)} aria-label="Protection">
            <option value="none">No protection</option><option value="password">Password</option><option value="key">Split key</option></select>
          {protect === 'password' && <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} aria-label="Password" />}
          <label><input type="checkbox" checked={useSchema} onChange={e => setUseSchema(e.target.checked)} /> Work-order schema</label>
          <select value={encoding} onChange={e => setEncoding(e.target.value)} aria-label="Encoding">
            <option value="b">base80 (shortest)</option><option value="a">base64url (chat-safe)</option></select>
          <label><input type="checkbox" checked={useWorker} onChange={e => setUseWorker(e.target.checked)} /> Worker</label>
          <button className="primary" disabled={db.status === 'saving' || dict === null} onClick={() => run('Saved', () => db.save(input, secretOpts))}>Save to link</button>
        </div>
        <div className="row">
          <label>Split into parts of max <input type="number" min="100" step="100" value={maxChars} onChange={e => setMaxChars(+e.target.value)} style={{ width: 90 }} aria-label="Max characters per part" /> chars</label>
          <button disabled={db.status === 'saving' || dict === null} onClick={() => run('', async () => { const r = await db.saveParts(input, { ...secretOpts, maxChars }); return r.parts.length > 1 ? `Split into ${r.parts.length} links.` : 'Fits in one link, no need to split.'; })}>Make multi-part links</button>
        </div>
        {db.result && <>
          {!db.links.length && <div className="box link">{db.link.length > 3000 ? db.link.slice(0, 3000) + '…' : db.link}</div>}
          <p><span className={cls}>{fmt(db.link.length)} chars, {note}</span> · {db.result.format} + {db.result.compression}
            {db.result.verified ? ' · verified' : ''}{db.result.schemaFallback ? ` · schema not used: ${db.result.schemaFallback}` : ''}</p>
          {db.result.key && <p><b>Key:</b> <code>{db.result.key}</code> <button onClick={() => navigator.clipboard.writeText(db.result.key)}>Copy key</button>
            <br /><span className="muted">Send the key by a different channel than the link (for example the link by email, the key by text message).</span></p>}
          {db.links.length > 0 && <ol className="parts">{db.links.map((l, i) => <li key={i}><a href={l} target="_blank" rel="noopener">Part {i + 1}</a> ({fmt(l.length)} chars) <button onClick={() => navigator.clipboard.writeText(l)}>Copy</button></li>)}</ol>}
          <div className="row">
            <button onClick={() => run('', () => db.share())}>Share</button>
            <button onClick={() => db.exportFile()}>Export .fdb</button>
            {FDB.nfc.supported() && <button onClick={() => run('Written to NFC tag', () => FDB.nfc.write(db.link))}>Write NFC tag</button>}
          </div>
        </>}
        <div className="row"><label>Open a .fdb file <input type="file" accept=".fdb" onChange={e => e.target.files[0] && db.importFile(e.target.files[0])} /></label></div>
        {msg && <p className="muted">{msg}</p>}
      </section>

      <section>
        <h2>Same-network transfer (any size, no servers)</h2>
        <p className="muted">Both devices must be on the same Wi-Fi or LAN. Exchange the two codes by copy/paste or any messenger.</p>
        <div className="row">
          <button onClick={() => lan.send(input)}>Send current data</button>
          <input placeholder="Paste a code from the other device" value={peerCode} onChange={e => setPeerCode(e.target.value)} aria-label="Code from other device" />
          <button disabled={!peerCode} onClick={() => lan.state === 'waiting-for-answer' ? lan.accept(peerCode) : lan.receive(peerCode)}>
            {lan.state === 'waiting-for-answer' ? 'Connect' : 'Receive'}</button>
        </div>
        <p className="muted">State: {lan.state}{lan.progress ? ` · ${Math.round(lan.progress * 100)}%` : ''}{lan.error ? ` · ${lan.error.message}` : ''}</p>
        {lan.code && <><div className="box link">{lan.code}</div>
          <button onClick={() => navigator.clipboard.writeText(lan.code)}>Copy code ({lan.code.length} chars)</button></>}
        <DataView data={lan.data} />
      </section>
    </main>
  );
}
