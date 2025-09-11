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
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
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
        const wanted = ['code_128','code_39','code_93','itf','codabar','ean_13','ean_8','upc_a','upc_e','qr_code','data_matrix'];
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
    
    // Initialize manual crop UI
    try {
      initCropUI();
      log('Manual crop UI initialization completed');
    } catch (cropInitError) {
      log(`ERROR initializing crop UI: ${cropInitError.message}`);
    }
    

    
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
            // Prefer any barcode that contains an Amazon TBA tracking string
            let best = barcodes.find(b => /^TBA\d+/i.test((b.rawValue||'').trim()));
            if (!best) {
              // Prefer the longest rawValue (often the tracking barcode)
              best = barcodes.sort((a,b)=> (b.rawValue?.length||0)-(a.rawValue?.length||0))[0];
            }
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
    
    // Show the uploaded image on screen
    showUploadedImage(file);
    
    let result = null;
    let nativeResult = null;
    
    // Try native BarcodeDetector first if available
    if (nativeDetector) {
      try {
        const img = await createImageElement(file);
        const barcodes = await nativeDetector.detect(img);
        log(`Native detector found ${barcodes.length} barcodes`);
        
        if (barcodes && barcodes.length > 0) {
          // Prefer any barcode that contains an Amazon TBA tracking string
          let best = barcodes.find(b => /^TBA\d+/i.test((b.rawValue||'').trim()));
          if (!best) {
            // Prefer the longest rawValue (often the tracking barcode)
            best = barcodes.sort((a,b)=> (b.rawValue?.length||0)-(a.rawValue?.length||0))[0];
          }
          const text = (best?.rawValue || '').trim();
          if (text) {
            log(`Native detector result: "${text}"`);
            nativeResult = { getText: () => text };
          }
        }
      } catch (nativeErr) {
        log(`Native detector error: ${nativeErr.message}`);
      }
    }
    
    // Try multiple image processing approaches optimized for tracking barcodes
    const imageVariations = [
      () => createImageElement(file),
      () => createCanvasFromFile(file, 2.0), // Double size for small barcodes
      () => createCanvasFromFile(file, 1.5), // 150% scale
      () => createCanvasFromFile(file, 1.0), // Original size
      () => createCanvasFromFile(file, 0.75), // 75% scale  
      () => createBandCanvasFromFile(file, 2.0), // auto-detected barcode band
      () => createBandCanvasFromFile(file, 1.5), // smaller upscale
      () => createCroppedCanvas(file, 0.55, 0.35, 2.0), // lower center band, scaled
      () => createCroppedCanvas(file, 0.35, 0.40, 2.0), // central band
      () => createAdaptiveThresholdCanvas(file, 12, 10, 2.0), // aggressive local threshold
      () => createAdaptiveThresholdCanvas(file, 24, 12, 1.5), // larger window
      () => createAdaptiveThresholdCanvas(file, 12, 10, 1.0), // try without upscale
      () => createVerticalEnhanceCanvas(file, 2.0), // emphasize vertical bars
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
    
    // Only try ZXing variations if native detector didn't find anything
    if (!nativeResult) {
      for (let i = 0; i < imageVariations.length && !result; i++) {
        try {
          const imageElement = await imageVariations[i]();
          attemptCount++;
          log(`Trying ZXing variation ${i + 1}/${imageVariations.length}`);
          
          try {
            result = await codeReader.decodeFromImageElement(imageElement);
            if (result) {
              log(`ZXing success with variation ${i + 1}`);
              break;
            }
          } catch (readerError) {
            log(`ZXing variation ${i + 1} failed: ${readerError.message}`);
            
            // Try with a more permissive reader configuration
            try {
              const permissiveReader = new (await import('https://cdn.jsdelivr.net/npm/@zxing/browser@latest/+esm')).BrowserMultiFormatReader();
              const permissiveHints = new Map();
              const BarcodeFormat = (await import('https://cdn.jsdelivr.net/npm/@zxing/library@latest/+esm')).BarcodeFormat;
              const DecodeHintType = (await import('https://cdn.jsdelivr.net/npm/@zxing/library@latest/+esm')).DecodeHintType;
              
              permissiveHints.set(DecodeHintType.TRY_HARDER, true);
              permissiveHints.set(DecodeHintType.PURE_BARCODE, false);
              permissiveHints.set(DecodeHintType.ALSO_INVERTED, true);
              permissiveReader.hints = permissiveHints;
              
              result = await permissiveReader.decodeFromImageElement(imageElement);
              if (result) {
                log(`ZXing success with permissive reader on variation ${i + 1}`);
                break;
              }
            } catch (permissiveError) {
              log(`ZXing permissive reader also failed on variation ${i + 1}: ${permissiveError.message}`);
            }
          }
        } catch (imageError) {
          log(`ZXing image variation ${i + 1} failed: ${imageError.message}`);
        }
      }
    } else {
      log('Skipping ZXing variations since native detector found result');
    }
    
    // Use native result if available, otherwise ZXing result
    const finalResult = nativeResult || result;
    
    if (finalResult) {
      const scannedText = finalResult.getText();
      log(`Successfully decoded: "${scannedText}"`);
      
      const tracking = pickTracking(scannedText);
      renderState(scannedText, tracking);
      
      statusEl.textContent = 'Image processed successfully - manual crop still available below';
    } else {
      statusEl.textContent = 'No barcode found - use manual crop below';
      log(`Failed to detect barcode after ${attemptCount} attempts (native: ${!!nativeResult}, zxing: ${!!result})`);
    }
    
    // Always show manual crop UI for uploaded images (whether barcode was found or not)
    log('Showing manual crop UI for uploaded image');
    try {
      showCropUI(file);
    } catch (cropError) {
      log(`Error showing crop UI: ${cropError.message}`);
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

/**
 * Create a cropped canvas from an image file focusing on a horizontal band
 * @param {File} file
 * @param {number} yStartFraction - fraction of image height to start crop (0..1)
 * @param {number} heightFraction - fraction of image height to include
 * @param {number} scale - scale multiplier for output canvas
 */
function createCroppedCanvas(file, yStartFraction = 0.5, heightFraction = 0.35, scale = 2.0) {
  return new Promise(async (resolve, reject) => {
    try {
      const img = await createImageElement(file);
      const srcW = img.width;
      const srcH = img.height;

      const cropY = Math.max(0, Math.floor(srcH * yStartFraction));
      const cropH = Math.min(srcH - cropY, Math.floor(srcH * heightFraction));
      const cropX = 0; // full width crop (barcode usually spans horizontally)
      const cropW = srcW;

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(cropW * scale);
      canvas.height = Math.floor(cropH * scale);
      const ctx = canvas.getContext('2d');

      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      log(`Cropped canvas created: ${canvas.width}x${canvas.height} (yStart:${yStartFraction}, hFrac:${heightFraction}, scale:${scale})`);
      resolve(canvas);
    } catch (err) {
      reject(err);
    }
  });
}

function detectBarcodeBandFromCanvas(srcCanvas, bandFraction = 0.25, upscale = 2.0) {
  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, srcW, srcH);
  const data = imgData.data;

  // Compute luminance for each pixel row-wise and horizontal edge strength per row
  const rowScores = new Float32Array(srcH);
  for (let y = 0; y < srcH; y++) {
    let score = 0;
    let rowOffset = y * srcW * 4;
    for (let x = 0; x < srcW - 1; x++) {
      const i = rowOffset + x * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const l1 = 0.299 * r + 0.587 * g + 0.114 * b;
      const j = i + 4;
      const r2 = data[j], g2 = data[j+1], b2 = data[j+2];
      const l2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
      score += Math.abs(l2 - l1);
    }
    rowScores[y] = score;
  }

  // Sliding window to find the vertical-edge-dense band
  const windowH = Math.max(8, Math.floor(srcH * bandFraction));
  let bestSum = -1;
  let bestY = 0;
  let running = 0;
  for (let y = 0; y < srcH; y++) {
    running += rowScores[y] || 0;
    if (y >= windowH) running -= rowScores[y - windowH] || 0;
    if (y >= windowH - 1) {
      const start = y - (windowH - 1);
      if (running > bestSum) { bestSum = running; bestY = start; }
    }
  }

  // Crop and upscale the detected band
  const cropY = Math.max(0, bestY);
  const cropH = Math.min(srcH - cropY, windowH);
  const outW = Math.floor(srcW * upscale);
  const outH = Math.max(24, Math.floor(cropH * upscale));
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d');
  outCtx.drawImage(srcCanvas, 0, cropY, srcW, cropH, 0, 0, outW, outH);
  log(`Detected band crop at y=${cropY} h=${cropH} -> ${outW}x${outH}`);
  return out;
}

async function createBandCanvasFromFile(file, scale = 2.0) {
  const base = await createCanvasFromFile(file, scale);
  return detectBarcodeBandFromCanvas(base, 0.25, Math.max(1.5, scale));
}

/**
 * Create an adaptive (local mean) thresholded canvas from the image file.
 * Uses integral image for fast local mean computation.
 * @param {File} file
 * @param {number} window - local window radius in pixels
 * @param {number} C - constant subtracted from local mean
 * @param {number} scale - upscale multiplier
 */
function createAdaptiveThresholdCanvas(file, window = 16, C = 8, scale = 2.0) {
  return new Promise(async (resolve, reject) => {
    try {
      const img = await createImageElement(file);
      const srcW = Math.max(1, Math.floor(img.width));
      const srcH = Math.max(1, Math.floor(img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(srcW * scale);
      canvas.height = Math.floor(srcH * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const w = canvas.width, h = canvas.height;
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      // Build integral image of luminance
      const integral = new Float64Array((w + 1) * (h + 1));
      for (let y = 1; y <= h; y++) {
        let rowSum = 0;
        for (let x = 1; x <= w; x++) {
          const i = ((y - 1) * w + (x - 1)) * 4;
          const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          rowSum += l;
          integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + rowSum;
        }
      }

      const out = ctx.createImageData(w, h);
      const outData = out.data;
      const ws = Math.max(1, Math.floor(window));

      for (let y = 0; y < h; y++) {
        const y1 = Math.max(0, y - ws);
        const y2 = Math.min(h - 1, y + ws);
        for (let x = 0; x < w; x++) {
          const x1 = Math.max(0, x - ws);
          const x2 = Math.min(w - 1, x + ws);
          const A = (y1) * (w + 1) + (x1);
          const B = (y1) * (w + 1) + (x2 + 1);
          const Cidx = (y2 + 1) * (w + 1) + (x1);
          const D = (y2 + 1) * (w + 1) + (x2 + 1);
          const sum = integral[D] - integral[B] - integral[Cidx] + integral[A];
          const count = (y2 - y1 + 1) * (x2 - x1 + 1);

          const i = (y * w + x) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const mean = sum / count;
          const val = lum < (mean - C) ? 0 : 255;
          outData[i] = outData[i + 1] = outData[i + 2] = val;
          outData[i + 3] = 255;
        }
      }

      ctx.putImageData(out, 0, 0);
      log(`Adaptive threshold canvas created: ${canvas.width}x${canvas.height} (window:${window}, C:${C})`);
      resolve(canvas);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Create a canvas emphasizing vertical bar structures using a Sobel X-like filter
 * which highlights vertical gradients (good for 1D barcodes).
 * @param {File} file
 * @param {number} scale
 */
function createVerticalEnhanceCanvas(file, scale = 2.0) {
  return new Promise(async (resolve, reject) => {
    try {
      const img = await createImageElement(file);
      const srcW = img.width, srcH = img.height;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(srcW * scale);
      canvas.height = Math.floor(srcH * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const w = canvas.width, h = canvas.height;
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const out = ctx.createImageData(w, h);
      const outData = out.data;

      // Sobel X kernel
      const k = [ -1, 0, 1,
                  -2, 0, 2,
                  -1, 0, 1 ];

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let gx = 0;
          let idx = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const px = x + kx;
              const py = y + ky;
              const i = (py * w + px) * 4;
              const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              gx += l * k[idx++];
            }
          }
          const mag = Math.min(255, Math.abs(gx));
          const oi = (y * w + x) * 4;
          outData[oi] = outData[oi + 1] = outData[oi + 2] = mag;
          outData[oi + 3] = 255;
        }
      }

      // Simple contrast stretch to increase visibility
      ctx.putImageData(out, 0, 0);
      // convert to binary with a mid threshold to emphasize bars
      const binData = ctx.getImageData(0, 0, w, h);
      const bd = binData.data;
      for (let i = 0; i < bd.length; i += 4) {
        const v = bd[i] > 64 ? 255 : 0;
        bd[i] = bd[i + 1] = bd[i + 2] = v;
        bd[i + 3] = 255;
      }
      ctx.putImageData(binData, 0, 0);
      log(`Vertical-enhanced canvas created: ${canvas.width}x${canvas.height}`);
      resolve(canvas);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Show uploaded image on screen
 * @param {File} imageFile - The uploaded image file
 */
function showUploadedImage(imageFile) {
  const imageDisplay = document.getElementById('imageDisplay');
  const uploadedImage = document.getElementById('uploadedImage');
  
  if (!imageDisplay || !uploadedImage) {
    log('Image display elements not found');
    return;
  }
  
  const imageUrl = URL.createObjectURL(imageFile);
  uploadedImage.src = imageUrl;
  imageDisplay.classList.remove('hidden');
  
  log('Uploaded image displayed on screen');
  
  // Clean up old URL when image loads
  uploadedImage.onload = () => {
    // Keep the URL active for the crop UI
  };
}

/**
 * Manual Crop UI Implementation
 */
let cropCanvas = null;
let cropSelection = null;
let cropContainer = null;
let cropImage = null;
let cropStartX = 0;
let cropStartY = 0;
let cropEndX = 0;
let cropEndY = 0;
let isDragging = false;

function initCropUI() {
  cropCanvas = document.getElementById('cropCanvas');
  cropSelection = document.getElementById('cropSelection');
  cropContainer = document.getElementById('cropContainer');
  
  const cropScanBtn = document.getElementById('cropScan');
  const cropResetBtn = document.getElementById('cropReset');
  const cropCancelBtn = document.getElementById('cropCancel');
  
  log(`Crop UI elements found: canvas=${!!cropCanvas}, selection=${!!cropSelection}, container=${!!cropContainer}, scanBtn=${!!cropScanBtn}, resetBtn=${!!cropResetBtn}, cancelBtn=${!!cropCancelBtn}`);
  
  if (!cropCanvas || !cropSelection || !cropContainer || !cropScanBtn || !cropResetBtn || !cropCancelBtn) {
    log('ERROR: Some crop UI elements not found in DOM');
    return;
  }
  
  // Add mouse event listeners for crop selection
  cropCanvas.addEventListener('mousedown', startCropSelection);
  cropCanvas.addEventListener('mousemove', updateCropSelection);
  cropCanvas.addEventListener('mouseup', finishCropSelection);
  cropCanvas.addEventListener('mouseleave', finishCropSelection);
  
  // Add touch event listeners for mobile
  cropCanvas.addEventListener('touchstart', handleTouchStart);
  cropCanvas.addEventListener('touchmove', handleTouchMove);
  cropCanvas.addEventListener('touchend', handleTouchEnd);
  
  cropScanBtn.onclick = scanCroppedArea;
  cropResetBtn.onclick = resetCropSelection;
  cropCancelBtn.onclick = hideCropUI;
  
  log('Manual crop UI initialized successfully');
}

function showCropUI(imageFile) {
  log(`showCropUI called with file: ${imageFile?.name || 'unknown'}`);
  
  if (!cropCanvas || !cropContainer) {
    log('ERROR: Crop UI elements not available');
    return;
  }
  
  const ctx = cropCanvas.getContext('2d');
  const img = new Image();
  
  img.onload = () => {
    log(`Image loaded for crop UI: ${img.width}x${img.height}`);
    
    // Scale image to fit canvas while preserving aspect ratio
    const maxWidth = 600;
    const maxHeight = 400;
    let { width, height } = img;
    
    if (width > maxWidth) {
      height = (height * maxWidth) / width;
      width = maxWidth;
    }
    if (height > maxHeight) {
      width = (width * maxHeight) / height;
      height = maxHeight;
    }
    
    log(`Scaled canvas size: ${width}x${height}`);
    
    cropCanvas.width = width;
    cropCanvas.height = height;
    cropCanvas.style.maxWidth = '100%';
    
    ctx.drawImage(img, 0, 0, width, height);
    cropImage = img;
    
    // Show the crop UI
    cropContainer.classList.remove('hidden');
    cropSelection.classList.add('hidden');
    
    log('Manual crop UI displayed successfully');
  };
  
  img.onerror = () => {
    log('ERROR: Failed to load image for crop UI');
  };
  
  const imageUrl = URL.createObjectURL(imageFile);
  log(`Loading image for crop UI: ${imageUrl}`);
  img.src = imageUrl;
}

function resetCropSelection() {
  if (cropSelection) {
    cropSelection.classList.add('hidden');
  }
  log('Crop selection reset - drag to select new area');
}

function hideCropUI() {
  if (cropContainer) {
    cropContainer.classList.add('hidden');
  }
  if (cropSelection) {
    cropSelection.classList.add('hidden');
  }
  // Clean up URL object
  if (cropImage && cropImage.src) {
    URL.revokeObjectURL(cropImage.src);
  }
  cropImage = null;
  log('Crop UI hidden');
}

function startCropSelection(e) {
  const rect = cropCanvas.getBoundingClientRect();
  cropStartX = e.clientX - rect.left;
  cropStartY = e.clientY - rect.top;
  isDragging = true;
  
  cropSelection.classList.add('hidden');
}

function updateCropSelection(e) {
  if (!isDragging) return;
  
  const rect = cropCanvas.getBoundingClientRect();
  cropEndX = e.clientX - rect.left;
  cropEndY = e.clientY - rect.top;
  
  updateSelectionRect();
}

function finishCropSelection() {
  isDragging = false;
}

function handleTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const rect = cropCanvas.getBoundingClientRect();
  cropStartX = touch.clientX - rect.left;
  cropStartY = touch.clientY - rect.top;
  isDragging = true;
  
  cropSelection.classList.add('hidden');
}

function handleTouchMove(e) {
  e.preventDefault();
  if (!isDragging) return;
  
  const touch = e.touches[0];
  const rect = cropCanvas.getBoundingClientRect();
  cropEndX = touch.clientX - rect.left;
  cropEndY = touch.clientY - rect.top;
  
  updateSelectionRect();
}

function handleTouchEnd(e) {
  e.preventDefault();
  isDragging = false;
}

function updateSelectionRect() {
  if (!cropSelection || !cropCanvas) return;
  
  const rect = cropCanvas.getBoundingClientRect();
  
  const left = Math.min(cropStartX, cropEndX);
  const top = Math.min(cropStartY, cropEndY);
  const width = Math.abs(cropEndX - cropStartX);
  const height = Math.abs(cropEndY - cropStartY);
  
  if (width > 10 && height > 10) {
    cropSelection.style.left = `${left}px`;
    cropSelection.style.top = `${top}px`;
    cropSelection.style.width = `${width}px`;
    cropSelection.style.height = `${height}px`;
    cropSelection.classList.remove('hidden');
  }
}

async function scanCroppedArea() {
  if (!cropImage || !cropCanvas || cropSelection.classList.contains('hidden')) {
    log('No crop area selected');
    return;
  }
  
  try {
    // Get crop coordinates relative to the original image
    const canvasRect = cropCanvas.getBoundingClientRect();
    const scaleX = cropImage.width / cropCanvas.width;
    const scaleY = cropImage.height / cropCanvas.height;
    
    const left = Math.min(cropStartX, cropEndX) * scaleX;
    const top = Math.min(cropStartY, cropEndY) * scaleY;
    const width = Math.abs(cropEndX - cropStartX) * scaleX;
    const height = Math.abs(cropEndY - cropStartY) * scaleY;
    
    log(`Cropping area: ${Math.round(left)},${Math.round(top)} ${Math.round(width)}x${Math.round(height)}`);
    
    // Create a cropped canvas
    const croppedCanvas = document.createElement('canvas');
    const croppedCtx = croppedCanvas.getContext('2d');
    
    croppedCanvas.width = width;
    croppedCanvas.height = height;
    
    croppedCtx.drawImage(
      cropImage,
      left, top, width, height,
      0, 0, width, height
    );
    
    // Convert cropped canvas to blob and process it
    croppedCanvas.toBlob(async (blob) => {
      if (blob) {
        log('Processing cropped image...');
        // Create a File-like object from the blob
        const croppedFile = new File([blob], 'cropped-image.png', { type: 'image/png' });
        
        // Process the cropped image but don't show crop UI again
        statusEl.textContent = 'Processing cropped area...';
        
        try {
          let result = null;
          let nativeResult = null;
          
          // Try native BarcodeDetector first if available
          if (nativeDetector) {
            try {
              const img = await createImageElement(croppedFile);
              const barcodes = await nativeDetector.detect(img);
              log(`Native detector found ${barcodes.length} barcodes in cropped area`);
              
              if (barcodes && barcodes.length > 0) {
                let best = barcodes.find(b => /^TBA\d+/i.test((b.rawValue||'').trim()));
                if (!best) {
                  best = barcodes.sort((a,b)=> (b.rawValue?.length||0)-(a.rawValue?.length||0))[0];
                }
                const text = (best?.rawValue || '').trim();
                if (text) {
                  log(`Native detector result from crop: "${text}"`);
                  nativeResult = { getText: () => text };
                }
              }
            } catch (nativeErr) {
              log(`Native detector error on crop: ${nativeErr.message}`);
            }
          }
          
          // Try ZXing if native didn't work
          if (!nativeResult) {
            try {
              const img = await createImageElement(croppedFile);
              result = await codeReader.decodeFromImageElement(img);
              if (result) {
                log(`ZXing success on cropped area`);
              }
            } catch (zxingErr) {
              log(`ZXing failed on cropped area: ${zxingErr.message}`);
            }
          }
          
          const finalResult = nativeResult || result;
          
          if (finalResult) {
            const scannedText = finalResult.getText();
            log(`Successfully decoded from crop: "${scannedText}"`);
            
            const tracking = pickTracking(scannedText);
            renderState(scannedText, tracking);
            
            statusEl.textContent = 'Cropped area processed successfully';
          } else {
            statusEl.textContent = 'No barcode found in cropped area - try selecting a different area';
            log('No barcode found in cropped area');
          }
          
        } catch (error) {
          log(`Cropped area processing error: ${error.message}`);
          statusEl.textContent = `Error processing cropped area: ${error.message}`;
        }
      }
    }, 'image/png');
    
  } catch (error) {
    log(`Crop scan error: ${error.message}`);
  }
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

// Test DOM elements before initialization
log('=== DOM Element Check ===');
log(`cropContainer exists: ${!!document.getElementById('cropContainer')}`);
log(`cropCanvas exists: ${!!document.getElementById('cropCanvas')}`);
log(`cropSelection exists: ${!!document.getElementById('cropSelection')}`);
log(`cropScan button exists: ${!!document.getElementById('cropScan')}`);
log(`cropCancel button exists: ${!!document.getElementById('cropCancel')}`);
log('=== Starting Initialization ===');

// Initialize everything
initScanner();
