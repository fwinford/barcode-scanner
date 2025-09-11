import { BrowserMultiFormatReader } from 'https://cdn.jsdelivr.net/npm/@zxing/browser@latest/+esm';

export class BarcodeScanner {
  constructor() {
    this.reader = null;
    this.nativeDetector = null;
    this.currentStream = null;
    this.listeners = {};
  }

  async initialize() {
    const zxingMod = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@latest/+esm');
    const lib = await import('https://cdn.jsdelivr.net/npm/@zxing/library@latest/+esm');
    this.reader = new zxingMod.BrowserMultiFormatReader(undefined, 150);

    const hints = new Map();
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    this.reader.hints = hints;

    if ('BarcodeDetector' in window) {
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        this.nativeDetector = new BarcodeDetector({ formats: supported });
      } catch (e) {
        // ignore
      }
    }
  }

  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
  emit(evt, ...args) { (this.listeners[evt] || []).forEach(f => { try { f(...args); } catch(e){console.error(e);} }); }

  async stopCamera() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
      this.currentStream = null;
    }
    try { this.reader.reset(); } catch(e){}
  }

  async scanFromVideo(videoEl) {
    if (this.nativeDetector) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth || videoEl.clientWidth;
        canvas.height = videoEl.videoHeight || videoEl.clientHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const bars = await this.nativeDetector.detect(canvas);
        if (bars && bars.length) {
          const text = bars[0].rawValue;
          return { text, tracking: this.extractTrackingNumber(text) };
        }
      } catch (e) {
        // continue
      }
    }

    try {
      const result = await this.reader.decodeFromVideoElement(videoEl);
      const text = result?.getText?.();
      return { text, tracking: this.extractTrackingNumber(text) };
    } catch (e) {
      return null;
    }
  }

  async scanFromCanvas(canvasEl) {
    if (this.nativeDetector) {
      try {
        const bars = await this.nativeDetector.detect(canvasEl);
        if (bars && bars.length) {
          const text = bars[0].rawValue;
          return { text, tracking: this.extractTrackingNumber(text) };
        }
      } catch (e) {
        // continue
      }
    }

    try {
      const result = await this.reader.decodeFromCanvas(canvasEl);
      const text = result?.getText?.();
      return { text, tracking: this.extractTrackingNumber(text) };
    } catch (e) {
      return null;
    }
  }

  extractTrackingNumber(text) {
    if (!text) return null;
    const patterns = {
      UPS: /^1Z[0-9A-Z]{16}$/i,
      FedEx: /^(\d{12}|\d{15})$/,
      USPS: /^(\d{20,22}|\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2})$/,
      DHL: /^\d{10}$/,
      Amazon: /^(TBA\d{12}|AMZN\w{8,})$/i,
      OnTrac: /^C\d{14}$/
    };

    for (const [carrier, re] of Object.entries(patterns)) {
      const m = text.match(re);
      if (m) return { carrier, number: m[0] };
    }

    const clean = text.replace(/\s+/g, '');
    for (const [carrier, re] of Object.entries(patterns)) {
      const m = clean.match(re);
      if (m) return { carrier, number: m[0] };
    }

    return null;
  }
}
