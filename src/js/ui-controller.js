export class UIController {
  constructor() {
    this.statusEl = document.getElementById('status');
    this.debugEl = document.getElementById('debug');
    this.resultEl = document.getElementById('result');
  }

  updateForState(newState) {
    // Basic mapping; more rules in app.js
    this.log(`State changed: ${newState}`);
  }

  updateStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  log(text) {
    if (!this.debugEl) return;
    const time = new Date().toLocaleTimeString();
    this.debugEl.textContent = `[${time}] ${text}\n` + this.debugEl.textContent;
    console.log(text);
  }

  showResult(result) {
    if (!this.resultEl) return;
    this.resultEl.classList.remove('hidden');

    const rawText = (result && result.text) ? result.text : '';
    const tracking = (result && result.tracking) ? result.tracking : null;

    const trackingHtml = tracking ? `
          <div class="result-title"><span class="icon-package"></span><strong>${tracking.carrier} Tracking Number:</strong></div>
          <div class="result-value" id="resultTrackingValue">${tracking.number}</div>
          <button class="copy-btn" id="copyTrackingBtn"><span class="icon-copy"></span>Copy Tracking</button>
        ` : '';

    const rawHtml = `
        <div class="result-title"><strong>Scanned Raw Text:</strong></div>
        <div class="result-value" id="resultRawValue">${rawText}</div>
        <button class="copy-btn" id="copyRawBtn"><span class="icon-copy"></span>Copy Raw Text</button>
    `;

    this.resultEl.innerHTML = `
      <div class="result-content">
        <div class="result-text">
          ${trackingHtml}
          ${rawHtml}
        </div>
      </div>
    `;

    // Attach copy handlers
    const copyRawBtn = document.getElementById('copyRawBtn');
    if (copyRawBtn) copyRawBtn.addEventListener('click', () => this.copyToClipboard(rawText));

    const copyTrackingBtn = document.getElementById('copyTrackingBtn');
    if (copyTrackingBtn && tracking) copyTrackingBtn.addEventListener('click', () => this.copyToClipboard(tracking.number));

    // Auto-copy tracking number if available, otherwise don't auto-copy raw text
    if (tracking) {
      this.copyToClipboard(tracking.number);
    }
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.log(`Copied to clipboard: ${text}`);
      return true;
    } catch (error) {
      this.log(`Clipboard error: ${error.message}`);
      return false;
    }
  }

  showButton(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  hideButton(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  enableButton(id) {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  }

  disableButton(id) {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  }

  reset() {
    if (this.resultEl) {
      this.resultEl.classList.add('hidden');
      this.resultEl.innerHTML = '';
    }
    if (this.debugEl) this.debugEl.textContent = '';
    if (this.statusEl) this.statusEl.textContent = 'Ready to scan';
  }
}