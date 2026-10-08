/*! React hooks for FragmentDB and LanTransfer. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as FDB from './fragmentdb.js';
import { LanTransfer } from './lan.js';

/**
 * Keeps app data in the URL fragment.
 *   const db = useFragmentDB({ dict, schema, codec });
 *   db.status: 'idle' | 'loading' | 'saving' | 'ready' | 'locked' | 'collecting' | 'error'
 *     locked: needs a password (db.error.code === 'PASSWORD') or split key ('KEY') -> db.unlock(secret)
 *     collecting: a multi-part link; db.parts = { have, total, missing } -> open the other links
 *   db.data   decoded data ({ kind, value, name?, type? })
 *   db.result last save() result; db.link its full link; db.links one link per part (saveParts)
 *   db.save(input, { password | splitKey }) · db.saveParts(input, { maxChars }) · db.unlock(secret)
 *   db.share() · db.exportFile() · db.importFile(file)
 * Options: dict, schema, codec (client(worker) to run off the main thread), autoLoad (default true).
 */
export function useFragmentDB({ dict, schema, codec = FDB, autoLoad = true } = {}) {
  const key = JSON.stringify([dict ?? null, schema ?? null]);
  const cfg = useMemo(() => ({ dict, schema }), [key]); // stable even if the caller passes new objects each render
  const [st, setSt] = useState({ status: 'idle', data: null, result: null, parts: null, error: null });
  const set = p => setSt(s => ({ ...s, ...p }));
  const pending = useRef(null); // what to retry on unlock: the link, an assembled multi-part container or a file's container

  const open = useCallback(async (src, secret) => {
    pending.current = src; set({ status: 'loading', parts: null });
    try {
      const data = await codec.decode(src, { ...cfg, password: secret, key: secret });
      pending.current = null; set({ status: 'ready', data, error: null }); return data;
    } catch (e) { set({ status: e.code === 'PASSWORD' || e.code === 'KEY' ? 'locked' : 'error', error: e }); return null; }
  }, [codec, cfg]);

  const load = useCallback(async () => {
    const h = location.hash;
    if (h.length < 2) return set({ status: 'idle', data: null, error: null }), null;
    if (FDB.isPart(h)) { // parts are collected on the main thread (they persist in localStorage between page loads)
      try {
        const p = FDB.collectPart(h);
        if (!p.complete) return set({ status: 'collecting', parts: p, data: null, error: null }), null;
        return open(p.container);
      } catch (e) { return set({ status: 'error', error: e }), null; }
    }
    return open(h);
  }, [open]);

  useEffect(() => {
    if (!autoLoad) return;
    load();
    window.addEventListener('hashchange', load);
    return () => window.removeEventListener('hashchange', load);
  }, [load, autoLoad]);

  const save = useCallback(async (input, opts) => {
    set({ status: 'saving', error: null });
    try {
      const result = await codec.encode(input, { ...cfg, ...opts });
      history.replaceState(history.state, '', FDB.linkFor(result));
      set({ status: 'ready', result });
      return result;
    } catch (e) { set({ status: 'error', error: e }); throw e; }
  }, [codec, cfg]);

  const saveParts = useCallback(async (input, opts) => {
    set({ status: 'saving', error: null });
    try { const result = await codec.encodeParts(input, { ...cfg, ...opts }); set({ status: 'ready', result }); return result; }
    catch (e) { set({ status: 'error', error: e }); throw e; }
  }, [codec, cfg]);

  const importFile = useCallback(async file => {
    try { return open(await FDB.readFdb(file)); } catch (e) { set({ status: 'error', error: e }); return null; }
  }, [open]);
  const unlock = useCallback(secret => open(pending.current ?? location.hash, secret), [open]);
  const share = useCallback(opts => st.result ? FDB.share(st.result, opts) : null, [st.result]);
  const exportFile = useCallback(name => st.result && FDB.download(FDB.toFile(st.result, name)), [st.result]);
  const link = useMemo(() => st.result ? FDB.linkFor(st.result) : '', [st.result]);
  const links = useMemo(() => st.result?.parts?.length > 1 ? st.result.parts.map(fragment => FDB.linkFor({ fragment })) : [], [st.result]);

  return { ...st, link, links, load, save, saveParts, unlock, share, exportFile, importFile };
}

/** Same-network transfer with no servers. send() → give `code` to the receiver → accept(theirCode). */
export function useLanTransfer(opts) {
  const ref = useRef(null);
  const idle = { state: 'idle', progress: 0, code: '', data: null, error: null };
  const [st, setSt] = useState(idle);
  const set = p => setSt(s => ({ ...s, ...p }));
  const fresh = () => {
    ref.current?.close();
    return ref.current = new LanTransfer({
      onProgress: (a, b) => set({ progress: b ? a / b : 1 }),
      onState: s => s === 'failed' && set({ state: 'failed', error: new Error('Could not connect. Are both devices on the same network?') }),
    });
  };
  const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { set({ state: 'failed', error: e }); } };
  useEffect(() => () => ref.current?.close(), []);

  return {
    ...st,
    send: useCallback(guard(async input => { set({ ...idle, state: 'preparing' }); set({ code: await fresh().createOffer(input, opts), state: 'waiting-for-answer' }); }), []),
    accept: useCallback(guard(async answer => { set({ state: 'connecting' }); await ref.current.acceptAnswer(answer); set({ state: 'sent' }); }), []),
    receive: useCallback(guard(async offer => {
      set({ ...idle, state: 'preparing' });
      const t = fresh(); set({ code: await t.join(offer, opts), state: 'waiting-for-sender' });
      set({ data: await t.received, state: 'received' });
    }), []),
    reset: useCallback(() => { ref.current?.close(); ref.current = null; setSt(idle); }, []),
  };
}
