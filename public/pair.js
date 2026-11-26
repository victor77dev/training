'use strict';
/* =========================================================================
   QR pairing UI: draws pairing codes as QR, scans them with the camera,
   and walks both devices through the two-step handshake (see QrTransport).
     Big screen: show offer QR  ->  scan the phone's answer QR
     Phone:      scan offer QR  ->  show answer QR
   Copy/paste is offered as a fallback when a camera is not available.
   ========================================================================= */

const QR = {
  async svg(text) {
    await loadScript('vendor/qrcode-generator.js');
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Alphanumeric');
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  },
};

const Scanner = {
  stream: null, raf: 0, active: false,
  get supported() { return !!navigator.mediaDevices?.getUserMedia; },
  async start(video, onCode) {
    this.stop();
    await loadScript('vendor/jsQR.js');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    video.srcObject = this.stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    this.active = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let last = 0;
    const tick = (t) => {
      if (!this.active) return;
      this.raf = requestAnimationFrame(tick);
      if (t - last < 120 || video.readyState < 2 || !video.videoWidth) return;
      last = t;
      const scale = Math.min(1, 960 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (found?.data?.startsWith('RT')) { this.stop(); onCode(found.data); }
    };
    this.raf = requestAnimationFrame(tick);
  },
  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  },
};

const Pair = {
  myCode: '',
  busy: false,

  els() {
    return {
      dlg: $('#pairDialog'), title: $('#pairTitle'), text: $('#pairText'), qr: $('#pairQr'),
      cam: $('#pairCam'), video: $('#pairVideo'), scanBtn: $('#pairScanBtn'), status: $('#pairStatus'),
      paste: $('#pairPaste'), copy: $('#pairCopy'), input: $('#pairInput'),
    };
  },

  bind() {
    const e = this.els();
    e.dlg.addEventListener('close', () => this.onClose());
    $('#pairClose').addEventListener('click', () => e.dlg.close());
    e.scanBtn.addEventListener('click', () => this.scan());
    e.copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(signalToText(this.myCode)); toast('Code copied'); }
      catch { e.input.value = signalToText(this.myCode); e.input.select(); toast('Select and copy the text'); }
    });
    $('#pairPasteBtn').addEventListener('click', () => {
      const v = e.input.value.trim();
      if (v) this.handle(textToSignal(v));
    });
  },

  // ---- big screen ----
  async startDisplay() {
    Net.start('qr', 'display');
    showDisplayWait();
    const e = this.open('Pair with QR · step 1 of 2',
      'On your phone: <b>Connect → Scan QR from the big screen</b>, and point it at this code.');
    this.status('Preparing code…');
    try {
      this.myCode = await Net.transport.createOffer();
      await this.showQr(this.myCode);
      this.status('');
      e.scanBtn.textContent = '📷 Step 2: scan the phone’s reply';
      e.scanBtn.hidden = false;
    } catch (err) { this.fail(err); }
  },

  // ---- phone ----
  startController() {
    Net.start('qr', 'controller');
    this.open('Scan the big screen',
      'Point your camera at the QR code on the big screen.');
    this.myCode = '';
    this.scan();
  },

  open(title, html) {
    const e = this.els();
    e.title.textContent = title;
    e.text.innerHTML = html;
    e.qr.hidden = true; e.qr.innerHTML = '';
    e.cam.hidden = true; e.scanBtn.hidden = true;
    e.input.value = ''; e.copy.hidden = true;
    e.paste.open = !Scanner.supported;
    this.status(Scanner.supported ? '' : 'Camera needs HTTPS (e.g. the GitHub Pages address). You can copy & paste the codes instead.');
    if (!e.dlg.open) e.dlg.showModal();
    return e;
  },

  async showQr(code) {
    const e = this.els();
    Scanner.stop(); e.cam.hidden = true;
    e.qr.innerHTML = await QR.svg(code);
    e.qr.hidden = false;
    e.copy.hidden = false;
  },

  async scan() {
    const e = this.els();
    if (!Scanner.supported) { e.paste.open = true; return; }
    e.qr.hidden = true; e.scanBtn.hidden = true; e.cam.hidden = false;
    if (Net.isDisplay) {
      e.title.textContent = 'Pair with QR · step 2 of 2';
      e.text.innerHTML = 'Hold the phone’s QR code up to this device’s camera.';
    }
    this.status('Looking for a QR code…');
    try { await Scanner.start(e.video, (code) => this.handle(code)); }
    catch (err) {
      e.cam.hidden = true; e.paste.open = true;
      if (Net.isDisplay) { e.qr.hidden = false; e.scanBtn.hidden = false; }
      this.status(err.name === 'NotAllowedError' ? 'Camera permission denied — use copy & paste below.'
        : 'No camera available — use copy & paste below.');
    }
  },

  // A code was scanned or pasted
  async handle(code) {
    if (this.busy || Net.mode !== 'qr') return;
    this.busy = true;
    const e = this.els();
    try {
      if (Net.isDisplay) {
        this.status('Connecting…');
        await Net.transport.acceptAnswer(code);
        this.waitForLink();
      } else {
        this.status('Creating reply…');
        this.myCode = await Net.transport.acceptOffer(code);
        e.title.textContent = 'Show this to the big screen';
        e.text.innerHTML = 'On the big screen tap <b>Scan the phone’s reply</b>, then hold this code up to its camera.';
        await this.showQr(this.myCode);
        this.status('Waiting for the big screen to scan…');
        this.waitForLink(120000);
      }
    } catch (err) {
      this.fail(err);
      if (Scanner.supported && !(Net.isController && this.myCode)) setTimeout(() => this.els().dlg.open && this.scan(), 1500);
    } finally { this.busy = false; }
  },

  waitForLink(ms = 15000) {
    clearTimeout(this.linkT);
    this.linkT = setTimeout(() => {
      if (Net.mode === 'qr' && !(Net.hasDisplay || Net.hasController)) this.status('Still not connected. Both devices must be on the same WiFi or hotspot — close and try again.');
    }, ms);
  },

  // called from Net.onChange
  sync() {
    const e = this.els();
    if (Net.mode === 'qr' && (Net.hasDisplay || Net.hasController) && e.dlg.open) {
      clearTimeout(this.linkT);
      e.dlg.close();
      toast('Paired ✓');
    }
  },

  onClose() {
    Scanner.stop();
    clearTimeout(this.linkT);
    // Phone gave up before connecting: drop the half-made connection.
    if (Net.mode === 'qr' && Net.isController && !Net.hasDisplay) Net.disconnect();
  },

  status(text) { this.els().status.textContent = text; },
  fail(err) { console.warn(err); this.status(err?.message || 'Something went wrong'); },
};
