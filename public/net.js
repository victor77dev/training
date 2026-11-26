'use strict';
/* =========================================================================
   Connection layer.

   Every transport gives the app the same interface:
     Net.mode     'relay' | 'online' | 'qr' | null
     Net.role     'display' | 'controller' | null
     Net.code     code to show (display) or the one entered (controller)
     Net.online   transport is up
     Net.peers    { display, controller }  how many of each are connected
     Net.send(msg)          deliver a JSON message to the other side(s)
     Net.disconnect()
   Hooks set by the app: Net.onMessage(msg), Net.onChange(), Net.onError(text)
   ========================================================================= */

const Net = {
  id: sessionStorage.getItem('rt.id') || (() => { const v = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('rt.id', v); return v; })(),
  mode: null, role: null, code: null, online: false,
  peers: { display: 0, controller: 0 },
  transport: null,
  relayAvailable: false,

  onMessage() {}, onChange() {}, onError() {},

  get isController() { return this.role === 'controller'; },
  get isDisplay() { return this.role === 'display'; },
  get hasDisplay() { return this.isController && this.online && this.peers.display > 0; },
  get hasController() { return this.isDisplay && this.peers.controller > 0; },

  start(mode, role, code = null) {
    this.disconnect(true);
    const Transport = TRANSPORTS[mode];
    if (!Transport) throw new Error(`Unknown connection mode: ${mode}`);
    Object.assign(this, { mode, role, code, online: false, peers: { display: 0, controller: 0 } });
    this.transport = new Transport(this);
    if (Transport.restorable) sessionStorage.setItem('rt.conn', JSON.stringify({ mode, role, code }));
    else sessionStorage.removeItem('rt.conn');
    this.transport.start(role, code);
    this.changed();
    return this.transport;
  },

  disconnect(silent) {
    this.transport?.close();
    this.transport = null;
    Object.assign(this, { mode: null, role: null, code: null, online: false, peers: { display: 0, controller: 0 } });
    if (!silent) { sessionStorage.removeItem('rt.conn'); this.changed(); }
  },

  send(msg) { this.transport?.send(msg); },

  // --- used by transports ---
  setOnline(v) { if (this.online !== v) { this.online = v; this.changed(); } },
  setPeers(p) { this.peers = { ...this.peers, ...p }; this.changed(); },
  receive(msg) { try { this.onMessage(msg); } catch (e) { console.error(e); } },
  changed() { try { this.onChange(); } catch (e) { console.error(e); } },

  // Is this page served by server.js (vs. static hosting such as GitHub Pages)?
  async detectRelay() {
    if (location.protocol === 'file:') return (this.relayAvailable = false);
    try {
      const r = await fetch('api/ping', { cache: 'no-store' });
      this.relayAvailable = r.ok && (await r.json()).relay === true;
    } catch { this.relayAvailable = false; }
    return this.relayAvailable;
  },

  // Reconnect after a page reload (only for transports that support it)
  restore() {
    let prev = null;
    try { prev = JSON.parse(sessionStorage.getItem('rt.conn')); } catch {}
    if (!prev || !TRANSPORTS[prev.mode]?.restorable) return null;
    if (prev.mode === 'relay' && !this.relayAvailable) return null;
    this.start(prev.mode, prev.role, prev.code);
    return prev;
  },
};

function randomCode(digits) {
  const min = 10 ** (digits - 1);
  return String(Math.floor(min + Math.random() * 9 * min));
}

/* ---------------- Local relay via server.js (SSE + POST) ---------------- */
class RelayTransport {
  static restorable = true;
  static codeLength = 4;
  constructor(net) { this.net = net; }
  start(role, code) {
    this.code = code;
    this.es = new EventSource(`events?room=${code}&role=${role}&id=${this.net.id}`);
    this.es.onopen = () => this.net.setOnline(true);
    this.es.onerror = () => this.net.setOnline(false);
    this.es.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'peers') this.net.setPeers({ display: m.display || 0, controller: m.controller || 0 });
      else this.net.receive(m);
    };
  }
  send(msg) {
    fetch(`send?room=${this.code}&id=${this.net.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
    }).catch(() => this.net.onError('Could not reach the local server'));
  }
  close() { this.es?.close(); }
}

/* -------- Online code via the free PeerJS broker, then direct WebRTC ------
   The broker only carries the WebRTC handshake. Once connected, messages
   flow directly between the devices. Needs internet for the handshake. */
const PEER_PREFIX = 'reaction-trainer-v1-';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) { existing.dataset.loaded ? resolve() : existing.addEventListener('load', resolve); return; }
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => { s.remove(); reject(new Error(`Failed to load ${src}`)); };
    document.head.appendChild(s);
  });
}

class PeerTransport {
  static restorable = true;
  static codeLength = 6;
  constructor(net) { this.net = net; this.conns = new Set(); this.closed = false; this.warned = false; }

  async start(role, code) {
    try { await loadScript('vendor/peerjs.min.js'); }
    catch { this.net.onError('Could not load the pairing library'); return; }
    if (this.closed) return;
    role === 'display' ? this.startDisplay(code) : this.startController(code);
  }

  makePeer(id) {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    peer.on('disconnected', () => {
      this.net.setOnline(false);
      // Lost the broker (not the devices); try to re-register so new devices can still join.
      setTimeout(() => { if (!this.closed && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
    });
    return peer;
  }

  startDisplay(code) {
    const peer = this.peer = this.makePeer(PEER_PREFIX + code);
    peer.on('open', () => this.net.setOnline(true));
    peer.on('connection', (conn) => this.track(conn));
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {           // someone else has this code: pick another
        peer.destroy();
        this.net.code = randomCode(PeerTransport.codeLength);
        sessionStorage.setItem('rt.conn', JSON.stringify({ mode: 'online', role: 'display', code: this.net.code }));
        this.net.changed();
        this.startDisplay(this.net.code);
      } else this.networkError(e);
    });
  }

  startController(code) {
    const peer = this.peer = this.makePeer(null);
    this.target = PEER_PREFIX + code;
    peer.on('open', () => { this.net.setOnline(true); this.connectToDisplay(); });
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') {
        if (!this.warned) this.net.onError(`No display with code ${code} found yet — retrying…`);
        this.warned = true;
        this.retry();
      } else this.networkError(e);
    });
  }

  connectToDisplay() {
    if (this.closed || this.conns.size || !this.peer?.open) return;
    this.track(this.peer.connect(this.target, { reliable: true, serialization: 'json' }));
  }
  retry() { clearTimeout(this.retryT); this.retryT = setTimeout(() => this.connectToDisplay(), 3000); }

  networkError(e) {
    console.warn('PeerJS error', e.type, e);
    if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) {
      this.net.setOnline(false);
      this.net.onError(e.type === 'browser-incompatible' ? 'This browser does not support WebRTC'
        : 'Online pairing needs internet — try QR pairing instead');
    }
  }

  track(conn) {
    conn.on('open', () => { this.conns.add(conn); this.warned = false; this.sync(); });
    conn.on('data', (m) => {
      if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return; } }
      if (m && typeof m === 'object') this.net.receive(m);
    });
    const gone = () => {
      if (!this.conns.delete(conn)) return;
      this.sync();
      if (this.net.isController) this.retry();     // e.g. display reloaded: reconnect
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  sync() { this.net.setPeers(this.net.isDisplay ? { controller: this.conns.size } : { display: this.conns.size }); }
  send(msg) { for (const c of this.conns) if (c.open) c.send(msg); }
  close() { this.closed = true; clearTimeout(this.retryT); this.peer?.destroy(); }
}

/* ------------- QR pairing: manual WebRTC handshake, no server -------------
   The big screen makes an offer, the phone scans it and replies with an
   answer, the big screen scans that. Each side gathers all its network
   candidates first, so a single message each way is enough. Works offline
   on the same WiFi/hotspot. */

// Handshake text -> short QR-friendly string:
//   "RT2" + base45(compact fields)            usual case, ~150 chars
//   "RT1" + base45(deflate-raw(type + sdp))   fallback for unusual SDPs
//   "RT0" + base45(utf8(type + sdp))          fallback without CompressionStream
// base45 keeps the QR in its denser alphanumeric mode.
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function b45encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let x = bytes[i] * 256 + bytes[i + 1];
      const c = x % 45; x = (x - c) / 45; const d = x % 45; const e = (x - d) / 45;
      s += B45[c] + B45[d] + B45[e];
    } else {
      const x = bytes[i];
      s += B45[x % 45] + B45[Math.floor(x / 45)];
    }
  }
  return s;
}
function b45decode(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 3) {
    const c = B45.indexOf(str[i]), d = B45.indexOf(str[i + 1]);
    if (i + 2 < str.length) {
      const e = B45.indexOf(str[i + 2]), x = c + d * 45 + e * 2025;
      if (c < 0 || d < 0 || e < 0 || x > 0xffff) throw new Error('bad code');
      out.push(x >> 8, x & 0xff);
    } else {
      const x = c + d * 45;
      if (c < 0 || d < 0 || x > 0xff) throw new Error('bad code');
      out.push(x);
    }
  }
  return new Uint8Array(out);
}
async function pipeBytes(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const canDeflate = (() => { try { new CompressionStream('deflate-raw'); new DecompressionStream('deflate-raw'); return true; } catch { return false; } })();

/* Compact format "RT2": only the fields WebRTC actually needs, packed as bytes.
   [flags][ufrag][pwd][32-byte sha-256 fingerprint][mid][candidates…]
   flags: bit0 = answer, bits1-2 = setup (0 actpass, 1 active, 2 passive)
   candidate: kind (0 mDNS uuid, 1 IPv4, 2 IPv6, 3 text) + address + port
   The SDP is rebuilt from these on the other side. */
const SETUPS = ['actpass', 'active', 'passive'];
const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
const hexBytes = (h) => h.match(/../g).map((x) => parseInt(x, 16));
const bytesHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
function ipv6Bytes(a) {
  const [head, tail] = a.includes('::') ? a.split('::') : [a, null];
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => { const v = parseInt(g, 16); return [v >> 8, v & 0xff]; });
}
function ipv6Text(b) {
  const g = []; for (let i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
  return g.join(':');
}

function packCompact(desc) {
  const L = desc.sdp.split(/\r?\n/);
  const get = (p) => (L.find((l) => l.startsWith(p)) || '').slice(p.length).trim();
  const ufrag = get('a=ice-ufrag:'), pwd = get('a=ice-pwd:'), fp = get('a=fingerprint:'), mid = get('a=mid:');
  const setup = SETUPS.indexOf(get('a=setup:'));
  if (!ufrag || !pwd || !mid || setup < 0 || !/^sha-256 /i.test(fp)) return null;
  if (L.filter((l) => l.startsWith('m=')).length !== 1) return null;
  const fpb = fp.slice(8).split(':').map((h) => parseInt(h, 16));
  if (fpb.length !== 32 || fpb.some(isNaN)) return null;
  const cands = L.filter((l) => l.startsWith('a=candidate:')).map((l) => l.split(' '))
    .filter((c) => c[2]?.toLowerCase() === 'udp' && c[7] === 'host').map((c) => ({ addr: c[4], port: +c[5] }));
  if (!cands.length) return null;

  const out = [(desc.type === 'answer' ? 1 : 0) | (setup << 1)];
  const str = (v) => { const b = new TextEncoder().encode(v); if (b.length > 255) throw 0; out.push(b.length, ...b); };
  try {
    str(ufrag); str(pwd); out.push(...fpb); str(mid);
    out.push(Math.min(cands.length, 8));
    for (const { addr, port } of cands.slice(0, 8)) {
      const m = addr.match(UUID_LOCAL);
      if (m) out.push(0, ...hexBytes(m.slice(1).join('')));
      else if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) out.push(1, ...addr.split('.').map(Number));
      else if (addr.includes(':') && ipv6Bytes(addr)) out.push(2, ...ipv6Bytes(addr));
      else { out.push(3); str(addr); }
      out.push(port >> 8, port & 0xff);
    }
  } catch { return null; }
  return new Uint8Array(out);
}

function unpackCompact(b) {
  let i = 0;
  const byte = () => { if (i >= b.length) throw new Error('bad code'); return b[i++]; };
  const take = (n) => { if (i + n > b.length) throw new Error('bad code'); const r = b.slice(i, i + n); i += n; return r; };
  const str = () => new TextDecoder().decode(take(byte()));
  const flags = byte();
  const type = flags & 1 ? 'answer' : 'offer', setup = SETUPS[(flags >> 1) & 3];
  const ufrag = str(), pwd = str();
  const fp = [...take(32)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const mid = str();
  const n = byte(), cands = [];
  for (let k = 0; k < n; k++) {
    const kind = byte();
    let addr;
    if (kind === 0) { const h = bytesHex(take(16)); addr = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`; }
    else if (kind === 1) addr = [...take(4)].join('.');
    else if (kind === 2) addr = ipv6Text(take(16));
    else addr = str();
    const port = (byte() << 8) | byte();
    cands.push(`a=candidate:${k + 1} 1 udp ${2122260223 - k} ${addr} ${port} typ host generation 0`);
  }
  const sdp = ['v=0', `o=- ${Date.now()} 2 IN IP4 127.0.0.1`, 's=-', 't=0 0', `a=group:BUNDLE ${mid}`, 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...cands,
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`, 'a=ice-options:trickle', `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${setup}`, `a=mid:${mid}`, 'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');
  return { type, sdp };
}

async function encodeSignal(desc) {
  const compact = packCompact(desc);
  if (compact) return 'RT2' + b45encode(compact);
  // Fallback: the whole SDP (minus TCP candidates), compressed when possible.
  const sdp = desc.sdp.split(/\r?\n/).filter((l) => l && !(l.startsWith('a=candidate') && / tcp /i.test(l))).join('\n');
  const raw = new TextEncoder().encode((desc.type === 'offer' ? 'o' : 'a') + sdp);
  return canDeflate ? 'RT1' + b45encode(await pipeBytes(raw, new CompressionStream('deflate-raw')))
    : 'RT0' + b45encode(raw);
}
async function decodeSignal(code) {
  code = code.trim();
  const ver = code.slice(0, 3);
  if (!['RT0', 'RT1', 'RT2'].includes(ver)) throw new Error('Not a Reaction Trainer pairing code');
  let bytes = b45decode(code.slice(3));
  if (ver === 'RT2') return unpackCompact(bytes);
  if (ver === 'RT1') {
    if (!canDeflate) throw new Error('This browser is too old to read this code');
    bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  }
  const text = new TextDecoder().decode(bytes);
  const type = text[0] === 'o' ? 'offer' : text[0] === 'a' ? 'answer' : null;
  if (!type) throw new Error('bad code');
  return { type, sdp: text.slice(1).split('\n').join('\r\n') + '\r\n' };
}
// Pasted codes travel through chat apps etc.; spaces (valid base45) are shown as "_" there.
const signalToText = (code) => code.replace(/ /g, '_');
const textToSignal = (text) => text.replace(/\s+/g, '').replace(/_/g, ' ');

function iceGathered(pc, maxMs = 3000) {
  // Host candidates arrive almost instantly; STUN may hang when offline, so cap the wait.
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, maxMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

class QrTransport {
  static restorable = false;
  static codeLength = 0;
  constructor(net) { this.net = net; this.ch = null; }
  start(role) {
    // QR pairing happens side by side on the same network, so local (host) candidates are enough.
    // No STUN: faster, works offline, and the code doesn't contain your public IP.
    const pc = this.pc = new RTCPeerConnection({ iceServers: [] });
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.setOpen(false); };
    if (role === 'display') this.bind(pc.createDataChannel('trainer', { ordered: true }));
    else pc.ondatachannel = (e) => this.bind(e.channel);
  }
  bind(ch) {
    this.ch = ch;
    ch.onopen = () => this.setOpen(true);
    ch.onclose = () => this.setOpen(false);
    ch.onmessage = (e) => { try { this.net.receive(JSON.parse(e.data)); } catch {} };
  }
  setOpen(v) {
    this.net.online = v;
    this.net.setPeers(this.net.isDisplay ? { controller: v ? 1 : 0 } : { display: v ? 1 : 0 });
  }
  // display: step 1
  async createOffer() {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await iceGathered(this.pc);
    return encodeSignal(this.pc.localDescription);
  }
  // remote: step 2 — returns the answer to show back
  async acceptOffer(code) {
    const desc = await decodeSignal(code);
    if (desc.type !== 'offer') throw new Error('That is the remote’s code — scan the one on the big screen');
    await this.pc.setRemoteDescription(desc);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await iceGathered(this.pc);
    return encodeSignal(this.pc.localDescription);
  }
  // display: step 3
  async acceptAnswer(code) {
    const desc = await decodeSignal(code);
    if (desc.type !== 'answer') throw new Error('That is a big-screen code — scan the one on the phone');
    await this.pc.setRemoteDescription(desc);
  }
  send(msg) { if (this.ch?.readyState === 'open') this.ch.send(JSON.stringify(msg)); }
  close() { try { this.ch?.close(); this.pc?.close(); } catch {} }
}

const TRANSPORTS = { relay: RelayTransport, online: PeerTransport, qr: QrTransport };
