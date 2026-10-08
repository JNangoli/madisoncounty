/*!
 * LanTransfer: send any amount of data browser-to-browser over WebRTC with NO servers
 * (no signaling, no STUN, no TURN). Works when both devices are on the same local network.
 * The two connection codes are exchanged by hand (copy/paste, Web Share, chat...).
 *
 * Sender:   const t = new LanTransfer(); const offer = await t.createOffer(data);  // give offer to receiver
 *           await t.acceptAnswer(answerFromReceiver);                               // resolves when delivered
 * Receiver: const t = new LanTransfer(); const answer = await t.join(offer);        // give answer to sender
 *           const { kind, value } = await t.received;
 */
import { encode, decode } from './fragmentdb.js';

const CHUNK = 64 * 1024, HIGH = 4 << 20;

const iceDone = pc => new Promise(res => {
  if (pc.iceGatheringState === 'complete') return res();
  const t = setTimeout(res, 3000); // host candidates normally arrive in milliseconds
  pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && (clearTimeout(t), res()));
});
// Connection codes are the SDP, minus useless TCP candidates, compressed by FragmentDB (base64url = chat-safe).
const toCode = async desc => (await encode(desc.sdp.split('\r\n').filter(l => !/^a=candidate:.* tcp /i.test(l)).join('\r\n'), { encoding: 'a', verify: false })).fragment;
const fromCode = async (code, type) => ({ type, sdp: (await decode(code.trim())).value });

export class LanTransfer {
  constructor({ onProgress, onState } = {}) {
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.onProgress = onProgress;
    this.pc.onconnectionstatechange = () => onState?.(this.pc.connectionState);
  }

  /** Sender, step 1. `input` is anything encode() accepts, or a ready container (Uint8Array from encode().container). */
  async createOffer(input, opts = {}) {
    this.payload = opts.container ? input : (await encode(input, { ...opts, verify: false })).container;
    const ch = this.pc.createDataChannel('fdb');
    ch.binaryType = 'arraybuffer';
    this.delivered = new Promise((res, rej) => {
      ch.onopen = () => this.#send(ch).then(res, rej);
      ch.onerror = e => rej(e.error || new Error('Transfer failed'));
    });
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await iceDone(this.pc);
    return toCode(this.pc.localDescription);
  }

  /** Sender, step 2. Resolves once the receiver confirms it got everything. */
  async acceptAnswer(code) {
    await this.pc.setRemoteDescription(await fromCode(code, 'answer'));
    return this.delivered;
  }

  async #send(ch) {
    const data = this.payload, acked = new Promise(r => ch.addEventListener('message', e => e.data === 'ok' && r()));
    ch.bufferedAmountLowThreshold = HIGH / 4;
    ch.send(JSON.stringify({ size: data.length }));
    for (let o = 0; o < data.length; o += CHUNK) {
      if (ch.bufferedAmount > HIGH) await new Promise(r => ch.addEventListener('bufferedamountlow', r, { once: true }));
      ch.send(data.subarray(o, o + CHUNK));
      this.onProgress?.(Math.min(o + CHUNK, data.length), data.length);
    }
    await acked;
  }

  /** Receiver: takes the sender's code, returns the answer code. Then await `this.received`. */
  async join(code, opts = {}) {
    this.received = new Promise((resolve, reject) => {
      this.pc.ondatachannel = ({ channel: ch }) => {
        ch.binaryType = 'arraybuffer';
        let buf = null, got = 0;
        ch.onmessage = e => {
          if (!buf) {
            const { size } = JSON.parse(e.data);
            if (!(size >= 0 && size < 2 ** 31)) return reject(new Error('Bad transfer header'));
            buf = new Uint8Array(size); if (size) return; // empty payload falls through
          } else { buf.set(new Uint8Array(e.data), got); got += e.data.byteLength; }
          this.onProgress?.(got, buf.length);
          if (got >= buf.length) { ch.send('ok'); decode(buf, opts).then(resolve, reject); }
        };
      };
    });
    await this.pc.setRemoteDescription(await fromCode(code, 'offer'));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await iceDone(this.pc);
    return toCode(this.pc.localDescription);
  }

  close() { this.pc.close(); }
}
