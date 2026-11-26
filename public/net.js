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

const TRANSPORTS = { relay: RelayTransport };
