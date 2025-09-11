(function() {
  // Compatibility wrapper: dynamically import the modular scanner and expose it globally.
  // This keeps the page working whether it includes the old root `scanner.js` as a plain
  // script or as a module — the wrapper creates a small module script that performs the import.

  // Helper to attach module exports to window for global access
  function attachModule(mod) {
    try {
      if (!mod) return;
      if (mod.BarcodeScanner) window.BarcodeScanner = mod.BarcodeScanner;
      // also attach any other exports for convenience
      window.ScannerModule = mod;
      console.log('scanner.js wrapper: attached modular scanner to window');
    } catch (e) {
      console.error('scanner.js wrapper attach failed:', e);
    }
  }

  // If running in an environment without DOM (e.g., SSR) bail early
  if (typeof document === 'undefined' || !document.head) return;

  try {
    // Create a module script that imports the real scanner module and attaches it to window
    const moduleScript = document.createElement('script');
    moduleScript.type = 'module';
    moduleScript.textContent = `
      import * as _mod from './src/js/scanner.js';
      try {
        window.BarcodeScanner = _mod.BarcodeScanner;
        window.ScannerModule = _mod;
        console.log('scanner.js (module) loaded and attached to window');
      } catch (e) {
        console.error('scanner.js module attach failed:', e);
      }
    `;
    document.head.appendChild(moduleScript);
  } catch (err) {
    console.error('scanner.js wrapper failed to create module script:', err);
    // Last-resort: try dynamic import (may fail in non-module contexts)
    try {
      import('./src/js/scanner.js').then(mod => attachModule(mod)).catch(e => console.error(e));
    } catch (e) {
      console.error('scanner.js dynamic import failed:', e);
    }
  }
})();
