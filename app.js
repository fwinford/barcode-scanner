/**
 * Package Tracking Scanner - Clean State Machine Implementation
 * Following requirements from SCANNER-UI-REFACTOR.md
 */

import { BarcodeScanner } from './src/js/scanner.js';
import { StateMachine } from './src/js/state-machine.js';
import { UIController } from './src/js/ui-controller.js';
import { CanvasUtils } from './src/js/canvas-utils.js';

class ScannerApp {
  constructor() {
    this.scanner = null;
    this.stateMachine = null;
    this.ui = null;
    this.canvasUtils = null;
    
    this.init();
  }

  async init() {
    try {
      console.log('Creating modules...');
      
      // Initialize modules in order
      this.ui = new UIController();
      this.stateMachine = new StateMachine();
      this.canvasUtils = new CanvasUtils();
      this.scanner = new BarcodeScanner();
      
      this.ui.log('Initializing scanner...');
      await this.scanner.initialize();
      
      this.ui.log('Setting up event listeners...');
      this.setupEventListeners();
      
      this.stateMachine.setState('idle');
      this.ui.updateStatus('Ready to scan');
      this.ui.log('App initialization complete');
    } catch (error) {
      console.error('Scanner initialization failed:', error);
      if (this.ui) {
        this.ui.updateStatus('Error initializing scanner');
        this.ui.log(`Initialization error: ${error.message}`);
      } else {
        document.getElementById('status').textContent = `Error: ${error.message}`;
      }
    }
  }

  setupEventListeners() {
    // Source controls
    document.getElementById('startCameraBtn').addEventListener('click', () => {
      this.handleStartCamera();
    });

    document.getElementById('uploadInput').addEventListener('change', (e) => {
      this.handleFileUpload(e);
    });

    // Action controls - only reset button now
    document.getElementById('resetBtn').addEventListener('click', () => {
      this.handleReset();
    });

    // State machine events
    this.stateMachine.on('stateChange', (newState, oldState) => {
      this.ui.updateForState(newState, oldState);
    });

    // Scanner events
    this.scanner.on('scanResult', (result) => {
      this.handleScanResult(result);
    });
  }

  async handleStartCamera() {
    try {
      this.stateMachine.setState('live-camera');
      this.ui.updateStatus('Starting camera...');
      this.ui.log('Requesting camera access...');
      
      const video = document.getElementById('previewVideo');
      const canvas = document.getElementById('previewCanvas');
      
      // Show video, hide canvas
      video.classList.remove('hidden');
      canvas.classList.add('hidden');
      
      // Get available cameras and let user choose
      // First request camera permission to get proper device labels
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(track => track.stop()); // Stop immediately
      } catch (e) {
        this.ui.log('Camera permission needed for device enumeration');
      }
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      
      // Debug: log all available cameras
      this.ui.log('Available cameras:');
      videoInputs.forEach((device, index) => {
        this.ui.log(`  ${index + 1}: "${device.label}" (ID: ${device.deviceId.substring(0, 8)}...)`);
      });
      
      let selectedDeviceId = null;
      
      if (videoInputs.length > 1) {
        // Always show camera selector for user choice
        const cameraOptions = videoInputs.map((device, index) => {
          const label = device.label || `Camera ${index + 1}`;
          const labelLower = label.toLowerCase();
          
          // Better detection patterns for iPhone/Continuity cameras
          const isIPhone = labelLower.includes('iphone') || 
                         labelLower.includes('continuity') ||
                         (labelLower.includes('camera') && !labelLower.includes('macbook') && !labelLower.includes('built') && !labelLower.includes('facetime'));
          const isMacBook = (labelLower.includes('macbook') || labelLower.includes('facetime') || labelLower.includes('built-in')) && 
                          !isIPhone;
          
          let displayName = label;
          if (isIPhone) displayName = `iPhone: ${label}`;
          else if (isMacBook) displayName = `MacBook: ${label}`;
          else displayName = `External: ${label}`; // Assume external if not clearly MacBook
          
          return { deviceId: device.deviceId, label: displayName, isIPhone, isMacBook };
        });
        
        // Debug camera options
        this.ui.log('Camera options detected:');
        cameraOptions.forEach((cam, i) => {
          this.ui.log(`  ${i + 1}: ${cam.label} (iPhone: ${cam.isIPhone}, MacBook: ${cam.isMacBook})`);
        });
        
        // Create camera selector UI - always show when multiple cameras
        let cameraSelector = document.getElementById('cameraSelector');
        if (!cameraSelector) {
          cameraSelector = document.createElement('select');
          cameraSelector.id = 'cameraSelector';
          cameraSelector.style.marginTop = '1rem';
          cameraSelector.style.width = '100%';
          cameraSelector.style.padding = '0.5rem';
          cameraSelector.style.fontSize = '16px';
          cameraSelector.style.borderRadius = '8px';
          cameraSelector.style.border = '2px solid #007AFF';
          
          const sourceControls = document.getElementById('sourceControls');
          sourceControls.appendChild(cameraSelector);
          
          // Add change event listener - start camera when selection changes
          cameraSelector.addEventListener('change', (e) => {
            const selectedDeviceId = e.target.value;
            if (selectedDeviceId && selectedDeviceId !== '') {
              this.ui.log(`User selected camera: ${cameraOptions.find(c => c.deviceId === selectedDeviceId)?.label}`);
              // Start camera immediately with selected device
              this.startCameraWithDevice(selectedDeviceId);
            } else {
              this.ui.updateStatus('Please select a camera from the dropdown');
            }
          });
        }
        
        // Populate selector with options
        const defaultOption = '<option value="">Choose a camera...</option>';
        cameraSelector.innerHTML = defaultOption + cameraOptions.map(cam => 
          `<option value="${cam.deviceId}">${cam.label}</option>`
        ).join('');
        
        // Show selector and wait for user choice
        this.ui.updateStatus('Please select a camera from the dropdown below');
        this.ui.log('Camera selector ready. Please choose your preferred camera.');
        return; // Always wait for user selection when multiple cameras available
      } else if (videoInputs.length === 1) {
        selectedDeviceId = videoInputs[0].deviceId;
      }

      let constraints;
      if (selectedDeviceId) {
        constraints = { 
          video: { 
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          } 
        };
      } else {
        constraints = { 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          } 
        };
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      this.scanner.currentStream = stream;
      
      await video.play();
      this.ui.updateStatus('Camera ready — scanning automatically');
      this.ui.log('Camera started successfully');

      // Enable manual crop immediately when camera starts
      this.setupCropInteraction(canvas, document.getElementById('cropOverlay'));

      // Start automatic continuous scanning loop
      this.startLiveScanLoop(video);
      
    } catch (error) {
      this.ui.updateStatus(`Camera access failed: ${error.message}`);
      this.ui.log(`Camera error: ${error.message}`);
      this.stateMachine.setState('idle');
    }
  }

  async startLiveScanLoop(video) {
    if (this._liveScanActive) return;
    this._liveScanActive = true;
    const scanIntervalMs = 400; // faster attempts
    let attempt = 0;

    while (this._liveScanActive && this.stateMachine.getState() === 'live-camera') {
      attempt++;
      try {
        const result = await this.scanner.scanFromVideo(video);
        if (result && result.text) {
          this.ui.log(`Live attempt ${attempt}: detected text ${result.text}`);

          // If scanner already provided a parsed tracking, use it; otherwise try to extract
          let tracking = result.tracking || null;
          if (!tracking && result.text) {
            try {
              // NEW: explicit debug logging to ensure extractTrackingNumber is invoked in runtime
              console.log('Calling extractTrackingNumber from startLiveScanLoop with text:', result.text);
              try {
                const bytes = Array.from(result.text).map(c => c.charCodeAt(0)).join(' ');
                console.log('Calling extractTrackingNumber - text bytes:', bytes);
              } catch (bErr) { /* ignore */ }

              tracking = this.scanner.extractTrackingNumber(result.text);
              console.log('extractTrackingNumber returned:', tracking);

              // FALLBACK: if scanner returned null, attempt simple GS-based extraction here
              if (!tracking && result.text) {
                try {
                  const GS = String.fromCharCode(29);
                  if (result.text.indexOf(GS) !== -1) {
                    const parts = result.text.split(GS).map(p => p.replace(/\s+/g, ''));
                    const last = parts[parts.length - 1];
                    if (last && /^\d{20,30}$/.test(last)) {
                      tracking = { carrier: 'USPS', number: last };
                      console.log('Fallback GS extraction found tracking:', tracking);
                    }
                  }
                } catch (gsErr) { console.log('GS fallback error:', gsErr.message); }
              }

              if (tracking) this.ui.log(`Extracted tracking from detected text: ${tracking.number}`);
            } catch (e) {
              this.ui.log('Error extracting tracking from text: ' + e.message);
            }
          }

          // If we have text but no tracking, show it anyway
          if (result.text) {
            const canvas = document.getElementById('previewCanvas');
            this.canvasUtils.captureVideoFrame(video, canvas);

            // Switch to static preview and stop live scanning
            video.classList.add('hidden');
            canvas.classList.remove('hidden');
            this.stateMachine.setState('static-preview');

            // Enable manual crop for the captured frame
            this.setupCropInteraction(canvas, document.getElementById('cropOverlay'));

            // Build unified result object preserving raw text and parsed tracking
            const unified = { text: result.text, tracking };
            this.handleScanResult(unified);

            // stop camera stream
            this.scanner.stopCamera();
            this._liveScanActive = false;
            break;
          }
        } else {
          if (attempt % 5 === 0) this.ui.log(`Live attempt ${attempt}: no result`);
        }
      } catch (err) {
        if (attempt % 5 === 0) this.ui.log(`Live attempt ${attempt}: error ${err.message}`);
      }
      await new Promise(r => setTimeout(r, scanIntervalMs));
    }
    this._liveScanActive = false;
  }

  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      this.stateMachine.setState('static-preview');
      this.ui.updateStatus('Loading image...');
      this.ui.log('Processing uploaded file...');

      const video = document.getElementById('previewVideo');
      const canvas = document.getElementById('previewCanvas');
      
      // Hide video, show canvas
      video.classList.add('hidden');
      canvas.classList.remove('hidden');

      // Load image to canvas using CanvasUtils (keeps DPR aware)
      await this.canvasUtils.loadImageToCanvas(canvas, file);

      this.ui.updateStatus('Processing image...');

      // Enable manual crop immediately when image loads
      this.setupCropInteraction(canvas, document.getElementById('cropOverlay'));

      // Use unified scanner method that tries native then ZXing
      const result = await this.scanner.scanFromCanvas(canvas);
      if (result && result.tracking) {
        this.ui.log(`Upload scan result: ${result.text}`);
        this.handleScanResult(result);
      } else {
        this.ui.updateStatus('No barcode found automatically - drag to select barcode area');
        this.ui.log('No barcode found - manual crop is ready');
      }
    } catch (error) {
      this.ui.updateStatus('Failed to load image');
      this.ui.log(`Image load error: ${error.message}`);
      this.stateMachine.setState('idle');
    }
  }

  handleScanResult(result) {
    // Debug logging to see what we're getting
    console.log('🔍 handleScanResult called with:', result);
    if (result) {
      console.log('  - text:', result.text);
      console.log('  - tracking:', result.tracking);
      if (result.tracking) {
        console.log('  - tracking.carrier:', result.tracking.carrier);
        console.log('  - tracking.number:', result.tracking.number);
      }
    }

    if (result && result.tracking) {
      this.ui.showResult(result);
      this.ui.updateStatus(`Found ${result.tracking.carrier} tracking number - drag to select different area if needed`);
      this.ui.log(`Successfully found tracking number: ${result.tracking.number} (scanned: "${result.text}")`);
    } else if (result && result.text) {
      this.ui.updateStatus(`Scanned: "${result.text}" - Not a recognized tracking number format. Drag to select different area.`);
      this.ui.log(`Scanned text not recognized as tracking number: "${result.text}"`);
    } else {
      this.ui.updateStatus('No barcode or QR code found automatically - drag to select barcode area');
      this.ui.log('No codes detected - manual crop is ready');
    }
  }

  setupCropInteraction(canvas, overlay) {
    // Clean up any existing listeners
    if (this.cleanupCropListeners) {
      this.cleanupCropListeners();
    }

    // Show the overlay for manual cropping
    overlay.classList.remove('hidden');
    overlay.style.pointerEvents = 'auto';

    let isDrawing = false;
    let startPoint = null;
    let cropRect = null;

    // Use overlay bounds since that's where the mouse events are
    const getCursorPosition = (e) => {
      const rect = overlay.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    const onMouseDown = (e) => {
      e.preventDefault();
      isDrawing = true;
      startPoint = getCursorPosition(e);
      
      // Clear existing crop rect
      const existingRect = overlay.querySelector('.crop-rect');
      if (existingRect) {
        existingRect.remove();
      }
      
      this.ui.log('Started manual crop selection');
    };

    const onMouseMove = (e) => {
      if (!isDrawing) return;
      e.preventDefault();
      
      const currentPoint = getCursorPosition(e);
      const width = Math.abs(currentPoint.x - startPoint.x);
      const height = Math.abs(currentPoint.y - startPoint.y);
      const left = Math.min(startPoint.x, currentPoint.x);
      const top = Math.min(startPoint.y, currentPoint.y);

      // Remove existing rect
      const existingRect = overlay.querySelector('.crop-rect');
      if (existingRect) {
        existingRect.remove();
      }

      // Create new crop rectangle
      cropRect = document.createElement('div');
      cropRect.className = 'crop-rect';
      cropRect.style.left = left + 'px';
      cropRect.style.top = top + 'px';
      cropRect.style.width = width + 'px';
      cropRect.style.height = height + 'px';
      
      overlay.appendChild(cropRect);
    };

    const onMouseUp = async (e) => {
      if (!isDrawing || !cropRect) return;
      e.preventDefault();
      
      isDrawing = false;
      this.ui.updateStatus('Processing selected area...');
      this.ui.log(`Processing crop area: ${cropRect.style.left}, ${cropRect.style.top}, ${cropRect.style.width}, ${cropRect.style.height}`);

      try {
        // Get crop dimensions relative to canvas
        const overlayRect = overlay.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        
        // Calculate crop area in canvas coordinates
        const scaleX = canvas.width / canvasRect.width;
        const scaleY = canvas.height / canvasRect.height;
        
        const cropData = {
          x: parseInt(cropRect.style.left) * scaleX,
          y: parseInt(cropRect.style.top) * scaleY,
          width: parseInt(cropRect.style.width) * scaleX,
          height: parseInt(cropRect.style.height) * scaleY
        };

        const croppedCanvas = this.canvasUtils.cropCanvas(canvas, cropData);
        const result = await this.scanner.scanFromCanvas(croppedCanvas);
        
        this.handleScanResult(result);
        
        // Clear the crop rect but keep overlay active for more crops
        const existingRect = overlay.querySelector('.crop-rect');
        if (existingRect) {
          existingRect.remove();
        }
        
      } catch (error) {
        this.ui.updateStatus('Manual crop processing failed - try selecting a different area');
        this.ui.log(`Crop error: ${error.message}`);
      }
    };

    // Add event listeners - use document for move/up to handle drag outside overlay
    overlay.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    // Clean up function
    this.cleanupCropListeners = () => {
      overlay.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      overlay.classList.add('hidden');
    };
  }

  async startCameraWithDevice(deviceId) {
    try {
      this.ui.updateStatus('Starting selected camera...');
      this.ui.log(`Starting camera with device ID: ${deviceId.substring(0, 8)}...`);
      
      const video = document.getElementById('previewVideo');
      const canvas = document.getElementById('previewCanvas');
      
      // Show video, hide canvas
      video.classList.remove('hidden');
      canvas.classList.add('hidden');
      
      // Stop any existing stream
      if (this.scanner.currentStream) {
        this.scanner.currentStream.getTracks().forEach(track => track.stop());
        this.scanner.currentStream = null;
      }

      const constraints = { 
        video: { 
          deviceId: { exact: deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      this.scanner.currentStream = stream;
      
      await video.play();
      
      // Ensure state is live-camera (was set earlier in handleStartCamera)
      if (this.stateMachine.getState() !== 'live-camera') {
        this.stateMachine.setState('live-camera');
      }
      this.ui.updateStatus('Camera ready — scanning automatically');
      this.ui.log('Camera started successfully');
      
      // Enable manual crop interaction while live (will apply once frame captured)
      this.setupCropInteraction(canvas, document.getElementById('cropOverlay'));
      
      // Start continuous live scan loop (previously called nonexistent this.startScanning())
      this.startLiveScanLoop(video);
    } catch (error) {
      console.error('Camera start error:', error);
      this.ui.updateStatus('Failed to start camera: ' + error.message);
      this.ui.log('Camera error: ' + error.message);
      this.stateMachine.setState('idle');
    }
  }

  handleReset() {
    // Stop camera if running
    this.scanner.stopCamera();
    this._liveScanActive = false;
    
    // Clean up crop listeners if they exist
    if (this.cleanupCropListeners) {
      this.cleanupCropListeners();
      this.cleanupCropListeners = null;
    }
    
    // Remove camera selector
    const cameraSelector = document.getElementById('cameraSelector');
    if (cameraSelector) {
      cameraSelector.remove();
    }
    
    // Hide all preview elements
    const video = document.getElementById('previewVideo');
    const canvas = document.getElementById('previewCanvas');
    const overlay = document.getElementById('cropOverlay');
    
    if (video) {
      video.classList.add('hidden');
      video.srcObject = null;
    }
    if (canvas) {
      canvas.classList.add('hidden');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    }
    
    // Clear UI elements
    this.ui.reset();
    
    // Reset to idle state
    this.stateMachine.setState('idle');
    this.ui.updateStatus('Ready to scan');
    this.ui.log('App reset to initial state');
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing scanner app...');
  try {
    new ScannerApp();
  } catch (error) {
    console.error('Failed to initialize scanner app:', error);
    document.getElementById('status').textContent = `Initialization failed: ${error.message}`;
  }
});
