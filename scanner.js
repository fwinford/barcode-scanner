/**
 * Package Tracking Scanner
 * Enhanced barcode scanner with iPhone Continuity Camera support
 */

import { BrowserMultiFormatReader } from 'https://cdn.jsdelivr.net/npm/@zxing/browser@latest/+esm';

// DOM elements
const statusEl = document.getElementById('status');
const camsEl = document.getElementById('cams');
const videoEl = document.getElementById('preview');
const resultEl = document.getElementById('result');
const debugEl = document.getElementById('debug');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const fileInput = document.getElementById('fileInput');

// Enhanced tracking number patterns
const trackingPatterns = {
  UPS: /^1Z[0-9A-Z]{16}$/i,
  FedEx: /^(\d{12}|\d{15})$/,
  USPS: /^(\d{20,22}|\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2})$/,
  DHL: /^\d{10}$/,
  Amazon: /^(TBA\d{12}|AMZN\w{8,})$/i,
  OnTrac: /^C\d{14}$/
};

let codeReader = null;
let isScanning = false;
let currentStream = null;
let nativeDetector = null;
let usingNativeDetector = false;
let rafId = null;

// Multi-scan state
let lastTracking = null;
let prevCandidate = null;
let stableCount = 0;
const STABLE_FRAMES = 3;    // require same code across N frames
let cooldownUntil = 0;
const COOLDOWN_MS = 900;    // ~1s before the same code can fire again

/**
 * Log debug messages to console and UI
 * @param {string} message - Message to log
 */
function log(message) {
  console.log(message);
  const timestamp = new Date().toLocaleTimeString();
  debugEl.textContent = `[${timestamp}] ${message}\n${debugEl.textContent}`;
}

// Helper to safely play video element
async function ensureVideoPlays(el){
  try { await el.play(); } catch(_) {}
}

/**
 * Extract tracking number from decoded text using carrier patterns
 * @param {string} text - Raw decoded text
 * @returns {Object|null} - {carrier, number} or null if no match
 */
function pickTracking(text) {
  log(`Analyzing scanned text: "${text}"`);
  
  // Try original text first
  for (const [carrier, pattern] of Object.entries(trackingPatterns)) {
    const match = text.match(pattern);
    if (match) {
      return { carrier, number: match[0] };
    }
  }
  
  // Try with spaces removed
  const clean = text.replace(/\s+/g, '');
  for (const [carrier, pattern] of Object.entries(trackingPatterns)) {
    const match = clean.match(pattern);
    if (match) {
      return { carrier, number: match[0] };
    }
  }
  
  // Special handling for USPS format like "9200 1903 4784 2230 0221 1616 74"
  const uspsSpaced = text.match(/(\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\s+\d{2})/);
  if (uspsSpaced) {
    return { carrier: 'USPS', number: uspsSpaced[1] };
  }
  
  // Look for any long number sequence that might be a tracking number
  const longNumber = text.match(/(\d{20,22})/);
  if (longNumber) {
    return { carrier: 'USPS', number: longNumber[1] };
  }
  
  log(`No tracking pattern matched for: "${text}"`);
  return null;
}

/**
 * Copy text to clipboard with error handling
 * @param {string} text - Text to copy
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    log(`Copied to clipboard: ${text}`);
    
    // Visual feedback
    const copyBtns = document.querySelectorAll('.copy-btn');
    copyBtns.forEach(btn => {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<span class="icon-copy"></span>Copied!';
      btn.style.background = '#2EAD4E';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.style.background = '';
      }, 2000);
    });
    
    return true;
  } catch (error) {
    log(`Clipboard error: ${error.message}`);
    return false;
  }
}

// Multi-scan helper: emits only after a candidate is stable across STABLE_FRAMES
function maybeEmit(tracking, rawText){
  const candidate = tracking?.number || null;
  if (!candidate){ prevCandidate = null; stableCount = 0; return false; }

  if (candidate === prevCandidate) stableCount++;
  else { prevCandidate = candidate; stableCount = 1; }

  const now = Date.now();
  if (stableCount >= STABLE_FRAMES && (candidate !== lastTracking || now > cooldownUntil)) {
    renderState(rawText, tracking);          // your renderState already copies to clipboard
    lastTracking = candidate;
    cooldownUntil = now + COOLDOWN_MS;
    return true;
  }
  return false;
}

/**
 * Render tracking result state
 * @param {string} rawText - Original scanned text
 * @param {Object|null} tracking - Tracking info or null
 */
function renderState(rawText, tracking) {
  resultEl.classList.remove('hidden');
  
  if (tracking) {
    resultEl.className = 'success';
    resultEl.innerHTML = `
      <div class="result-content">
        <div class="result-text">
          <div class="result-title"><span class="icon-package"></span><strong>${tracking.carrier} Tracking Number:</strong></div>
          <div class="result-value">${tracking.number}</div>
        </div>
        <button class="copy-btn" data-copy>
          <span class="icon-copy"></span>Copy
        </button>
      </div>
    `;
    const btn = resultEl.querySelector('[data-copy]');
    if (btn) btn.onclick = () => window.copyToClipboard(tracking.number);
    copyToClipboard(tracking.number);
  } else {
    resultEl.className = 'info';
    resultEl.innerHTML = `
      <div class="result-content">
        <div class="result-text">
          <div class="result-title"><span class="icon-document"></span><strong>Scanned Text:</strong></div>
          <div class="result-value">${rawText}</div>
          <div class="result-subtitle">Not a recognized tracking number format</div>
        </div>
      </div>
    `;
  }
}

/**
 * Get available video input devices
 * @returns {Promise<Array>} - Array of video input devices
 */
async function getVideoInputs() {
  try {
    // Request permission first
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(track => track.stop());
    
    // Get devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    log(`Found ${videoDevices.length} video input devices`);
    videoDevices.forEach((device, i) => {
      log(`  ${i + 1}. ${device.label || `Camera ${i + 1}`} (${device.deviceId.substring(0, 8)}...)`);
    });
    
    return videoDevices;
  } catch (error) {
    log(`Camera access error: ${error.message}`);
    throw error;
  }
}

/**
 * Initialize scanner and populate camera list
 */
async function initScanner() {
  try {
    statusEl.textContent = 'Loading ZXing library...';
    log('Initializing ZXing BrowserMultiFormatReader...');
    
    // Import additional readers for better barcode support
    const zxing = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@latest/+esm');
    codeReader = new zxing.BrowserMultiFormatReader(undefined, 150);
    
    // Configure for better barcode detection
    const hints = new Map();
    const BarcodeFormat = (await import('https://cdn.jsdelivr.net/npm/@zxing/library@latest/+esm')).BarcodeFormat;
    const DecodeHintType = (await import('https://cdn.jsdelivr.net/npm/@zxing/library@latest/+esm')).DecodeHintType;
    
    // Enable specific barcode formats commonly used for tracking
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.CODABAR,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX
    ]);
    
    // Improve accuracy
    hints.set(DecodeHintType.TRY_HARDER, true);
    
    codeReader.hints = hints;
    log('ZXing library loaded with enhanced barcode format support');

    // Native BarcodeDetector fallback (often better for Code 128)
    try {
      if ('BarcodeDetector' in window) {
        const supported = await BarcodeDetector.getSupportedFormats();
        const wanted = ['code_128','code_39','code_93','itf','codabar','ean_13','ean_8','upc_a','upc_e','data_matrix','qr_code'];
        const formats = wanted.filter(f => supported.includes(f));
        if (formats.length) {
          nativeDetector = new BarcodeDetector({ formats });
          log(`Native BarcodeDetector ready with formats: ${formats.join(', ')}`);
        }
      }
    } catch (e) {
      log(`BarcodeDetector not available: ${e.message}`);
    }
    
    statusEl.textContent = 'Requesting camera access...';
    const devices = await getVideoInputs();
    
    if (devices.length === 0) {
      statusEl.textContent = 'No cameras found. Please check permissions.';
      return;
    }
    
    // Populate camera dropdown
    camsEl.innerHTML = '<option value="">Select a camera...</option>';
    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      
      // Prioritize iPhone/Continuity Camera in display
      const label = device.label || `Camera ${index + 1}`;
      const isIPhone = label.toLowerCase().includes('iphone') || 
                     label.toLowerCase().includes('continuity');
      option.textContent = isIPhone ? `iPhone: ${label}` : label;
      
      camsEl.appendChild(option);
    });
    
    statusEl.textContent = 'Cameras loaded. Select camera and click Start.';
    startBtn.disabled = false;
    
  } catch (error) {
    log(`Init error: ${error.message}`);
    statusEl.textContent = `Error: ${error.message}`;
  }
}

/**
 * Start decoding from selected video device
 * @param {string} deviceId - Camera device ID
 */
async function startDecoding(deviceId) {
  try {
    if (isScanning) {
      await stopDecoding();
    }
    
    if (!deviceId) {
      statusEl.textContent = 'Please select a camera first';
      return;
    }
    
    statusEl.textContent = 'Starting camera...';
    log(`Starting camera with device ID: ${deviceId}`);
    
    // Get the video stream once
    const constraints = {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        facingMode: 'environment'
      }
    };
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = currentStream;
    videoEl.setAttribute('playsinline','');
    await ensureVideoPlays(videoEl);

    isScanning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    videoEl.classList.add('scanning');

    // Native BarcodeDetector path (if available)
    if (nativeDetector) {
      usingNativeDetector = true;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const loop = async () => {
        if (!usingNativeDetector) return;
        try {
          const trackSettings = currentStream.getVideoTracks()[0]?.getSettings?.() || {};
          const w = trackSettings.width || videoEl.videoWidth || 1280;
          const h = trackSettings.height || videoEl.videoHeight || 720;
          canvas.width = w; canvas.height = h;

          // Crop to a central horizontal band to avoid side QR/smaller codes
          const bandH = Math.floor(h * 0.35);
          const y = Math.floor((h - bandH) / 2);
          ctx.drawImage(videoEl, 0, y, w, bandH, 0, 0, w, bandH);

          const barcodes = await nativeDetector.detect(canvas);
          if (barcodes && barcodes.length) {
            // Prefer the longest rawValue (often the tracking barcode)
            const best = barcodes.sort((a,b)=> (b.rawValue?.length||0)-(a.rawValue?.length||0))[0];
            const text = (best?.rawValue || '').trim();
            if (text) {
              log(`Native detected: ${text}`);
              const tracking = pickTracking(text);
              if (maybeEmit(tracking, text)){
                videoEl.style.borderColor = '#34C759';
                videoEl.classList.add('success-flash');
                setTimeout(() => { videoEl.style.borderColor = ''; videoEl.classList.remove('success-flash'); }, 1200);
              }
            }
          }
        } catch (e) {
          // Normal to have occasional errors when no code is in view
        }
        rafId = requestAnimationFrame(loop);
      };

      rafId = requestAnimationFrame(loop);
      statusEl.textContent = 'Scanner active (native) - point camera at barcode';
      log('Using native BarcodeDetector loop');
      return; // Skip ZXing path when native is active
    }

    // ZXing path
    await codeReader.decodeFromVideoDevice(deviceId, videoEl, (result, error) => {
      if (result) {
        const scannedText = result.getText();
        log(`Scanned: ${scannedText}`);
        
        const tracking = pickTracking(scannedText);
        if (maybeEmit(tracking, scannedText)){
          videoEl.style.borderColor = '#34C759';
          videoEl.classList.add('success-flash');
          setTimeout(() => {
            videoEl.style.borderColor = '';
            videoEl.classList.remove('success-flash');
          }, 1500);
        }
      }
      
      if (error && error.name !== 'NotFoundException') {
        log(`Scan error: ${error.message}`);
      }
    });
    
    statusEl.textContent = 'Scanner active - point camera at barcode';
    log('Scanner is now active and ready');
    
  } catch (error) {
    log(`Start scanning error: ${error.message}`);
    statusEl.textContent = `Error starting scanner: ${error.message}`;
    isScanning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    videoEl.classList.remove('scanning');
    
    // Clean up stream if it was created
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
  }
}

/**
 * Stop video decoding and reset scanner
 */
async function stopDecoding() {
  try {
    usingNativeDetector = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (codeReader && isScanning) {
      codeReader.reset();
    }
    
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
    
    videoEl.srcObject = null;
    videoEl.classList.remove('scanning');
    isScanning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    statusEl.textContent = 'Scanner stopped';
    log('Scanner stopped');
    
  } catch (error) {
    log(`Stop error: ${error.message}`);
  }
}

/**
 * Decode barcode from uploaded image file
 * @param {File} file - Image file
 */
async function decodeFromFile(file) {
  try {
    statusEl.textContent = 'Processing image...';
    log(`Processing uploaded file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    
    let result = null;
    
    // Try multiple image processing approaches optimized for tracking barcodes
    const imageVariations = [
      () => createImageElement(file),
      () => createCanvasFromFile(file, 2.0), // Double size for small barcodes
      () => createCanvasFromFile(file, 1.5), // 150% scale
      () => createCanvasFromFile(file, 1.0), // Original size
      () => createCanvasFromFile(file, 0.75), // 75% scale  
      () => createBarcodeOptimizedCanvas(file), // Specialized for barcodes
      () => createEnhancedCanvasFromFile(file, 'highContrast'),
      () => createEnhancedCanvasFromFile(file, 'grayscale'),
      () => createEnhancedCanvasFromFile(file, 'sharpen'),
      () => createInvertedCanvas(file), // Try inverted colors
      () => createRotatedCanvas(file, 90), // Try rotated versions
      () => createRotatedCanvas(file, 180),
      () => createRotatedCanvas(file, 270)
    ];
    
    let attemptCount = 0;
    const maxAttempts = imageVariations.length;
    
    for (let i = 0; i < imageVariations.length && !result; i++) {
      try {
        const imageElement = await imageVariations[i]();
        attemptCount++;
        log(`Trying image variation ${i + 1}/${imageVariations.length}`);
        
        try {
          result = await codeReader.decodeFromImageElement(imageElement);
          if (result) {
            log(`Success with variation ${i + 1}`);
            break;
          }
        } catch (readerError) {
          log(`Variation ${i + 1} failed: ${readerError.message}`);
        }
      } catch (imageError) {
        log(`Image variation ${i + 1} failed: ${imageError.message}`);
      }
    }
    
    if (result) {
      const scannedText = result.getText();
      log(`Successfully decoded: "${scannedText}"`);
      
      const tracking = pickTracking(scannedText);
      renderState(scannedText, tracking);
      
      statusEl.textContent = 'Image processed successfully';
    } else {
      statusEl.textContent = 'No barcode found in image';
      log(`Failed to detect barcode after ${attemptCount} attempts`);
      log('Try taking a clearer photo with better lighting and focus on the barcode');
    }
    
  } catch (error) {
    log(`File decode error: ${error.message}`);
    statusEl.textContent = `Error processing image: ${error.message}`;
  }
}

/**
 * Create image element from file
 * @param {File} file - Image file
 * @returns {Promise<HTMLImageElement>} - Image element
 */
function createImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      log(`Image loaded: ${img.width}x${img.height}`);
      resolve(img);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
}

/**
 * Create canvas from image file for better barcode detection
 * @param {File} file - Image file
 * @param {number} scale - Scale multiplier (default 1.0)
 * @returns {Promise<HTMLCanvasElement>} - Canvas element
 */
function createCanvasFromFile(file, scale = 1.0) {
  return new Promise(async (resolve, reject) => {
    try {
      const img = await createImageElement(file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      log(`Canvas created: ${canvas.width}x${canvas.height} (scale: ${scale})`);
      resolve(canvas);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Create enhanced canvas with different processing types
 * @param {File} file - Image file
 * @param {string} enhancement - Type of enhancement
 * @returns {Promise<HTMLCanvasElement>} - Enhanced canvas element
 */
function createEnhancedCanvasFromFile(file, enhancement = 'highContrast') {
  return new Promise(async (resolve, reject) => {
    try {
      const img = await createImageElement(file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const maxSize = 1920;
      let { width, height } = img;
      
      if (width > maxSize || height > maxSize) {
        const scale = Math.min(maxSize / width, maxSize / height);
        width *= scale;
        height *= scale;
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      
      if (enhancement === 'highContrast') {
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const binary = gray > 128 ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = binary;
        }
      } else if (enhancement === 'grayscale') {
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.8 + 128));
          data[i] = data[i + 1] = data[i + 2] = enhanced;
        }
      } else if (enhancement === 'sharpen') {
        // Apply sharpening
        const originalData = new Uint8ClampedArray(data);
        for (let i = 0; i < data.length; i += 4) {
          if (i >= width * 4 && i < data.length - width * 4) {
            const current = originalData[i] * 0.299 + originalData[i + 1] * 0.587 + originalData[i + 2] * 0.114;
            const above = originalData[i - width * 4] * 0.299 + originalData[i - width * 4 + 1] * 0.587 + originalData[i - width * 4 + 2] * 0.114;
            const below = originalData[i + width * 4] * 0.299 + originalData[i + width * 4 + 1] * 0.587 + originalData[i + width * 4 + 2] * 0.114;
            
            const sharpened = Math.min(255, Math.max(0, current * 3 - above - below));
            data[i] = data[i + 1] = data[i + 2] = sharpened;
          }
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      log(`Enhanced canvas created (${enhancement}): ${canvas.width}x${canvas.height}`);
      resolve(canvas);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Create rotated canvas from image file
 * @param {File} file - Image file
 * @param {number} degrees - Rotation in degrees
 * @returns {Promise<HTMLCanvasElement>} - Rotated canvas element
 */
function createRotatedCanvas(file, degrees) {
  return new Promise(async (resolve, reject) => {
    try {
      const img = await createImageElement(file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const radians = (degrees * Math.PI) / 180;
      
      if (degrees === 90 || degrees === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(radians);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      
      log(`Rotated canvas created: ${canvas.width}x${canvas.height} (${degrees}°)`);
      resolve(canvas);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Create barcode-optimized canvas with preprocessing specifically for tracking barcodes
 * @param {File} file - Image file
 * @returns {Promise<HTMLCanvasElement>} - Optimized canvas element
 */
function createBarcodeOptimizedCanvas(file) {
  return new Promise(async (resolve, reject) => {
    try {
      const img = await createImageElement(file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Scale up if barcode area is small
      const scale = Math.max(2.0, 800 / Math.min(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Optimize for barcode detection
      for (let i = 0; i < data.length; i += 4) {
        // Convert to grayscale
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        
        // Apply strong threshold for barcode lines
        const threshold = 140; // Adjust based on image brightness
        const binary = gray > threshold ? 255 : 0;
        
        data[i] = binary;     // Red
        data[i + 1] = binary; // Green  
        data[i + 2] = binary; // Blue
      }
      
      ctx.putImageData(imageData, 0, 0);
      log(`Barcode-optimized canvas created: ${canvas.width}x${canvas.height} (scale: ${scale.toFixed(1)}x)`);
      resolve(canvas);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Create inverted canvas (swap black/white) for barcodes that might be inverted
 * @param {File} file - Image file
 * @returns {Promise<HTMLCanvasElement>} - Inverted canvas element
 */
function createInvertedCanvas(file) {
  return new Promise(async (resolve, reject) => {
    try {
      const img = await createImageElement(file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = img.width;
      canvas.height = img.height;
      
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Invert colors
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];         // Red
        data[i + 1] = 255 - data[i + 1]; // Green
        data[i + 2] = 255 - data[i + 2]; // Blue
        // Alpha channel unchanged
      }
      
      ctx.putImageData(imageData, 0, 0);
      log(`Inverted canvas created: ${canvas.width}x${canvas.height}`);
      resolve(canvas);
    } catch (error) {
      reject(error);
    }
  });
}

// Event listeners
startBtn.onclick = () => startDecoding(camsEl.value);
stopBtn.onclick = stopDecoding;
camsEl.onchange = () => {
  if (isScanning) {
    startDecoding(camsEl.value);
  }
};

fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (file) {
    decodeFromFile(file);
  }
};

// Make copyToClipboard available globally for button onclick
window.copyToClipboard = copyToClipboard;

// Initialize everything
initScanner();
