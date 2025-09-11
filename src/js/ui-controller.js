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
    this.resultEl.innerHTML = `
      <div class="result-content">
        <div class="result-text">
          <div class="result-title"><span class="icon-package"></span><strong>${result.tracking.carrier} Tracking Number:</strong></div>
          <div class="result-value">${result.tracking.number}</div>
        </div>
        <button class="copy-btn" onclick="navigator.clipboard.writeText('${result.tracking.number}')">
          <span class="icon-copy"></span>Copy
        </button>
      </div>
    `;
    
    // Auto-copy to clipboard
    this.copyToClipboard(result.tracking.number);
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