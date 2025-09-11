# Package Tracking Scanner - Refactored

A clean, modular barcode scanner implementation following the requirements from `SCANNER-UI-REFACTOR.md`.

## Project Structure

```
├── scan.html           # Main HTML file
├── app.js             # Main application entry point
├── style.css          # Clean CSS styles (white design)
└── src/
    └── js/
        ├── scanner.js          # Barcode scanning logic
        ├── state-machine.js    # State management
        ├── ui-controller.js    # DOM manipulation
        └── canvas-utils.js     # Canvas utilities with DPR handling
```

## Key Features

### State Machine Implementation
- **idle**: Ready to start scanning
- **live-camera**: Camera is active  
- **static-preview**: Showing captured/uploaded image
- **manual-crop**: User drawing crop rectangle

### Fixed Preview Area
- Consistent 600×400px dimensions (responsive breakpoints for mobile)
- No layout jumps between states
- Proper device pixel ratio handling for crisp rendering

## Quick local preview
1. From the project folder: `python3 -m http.server 8003`
2. Open http://localhost:8003/scan.html in a browser with camera accessracking Barcode Scanner

This is a small static web app that uses ZXing and the browser BarcodeDetector (when available) to scan package tracking barcodes from a camera (including iPhone Continuity Camera) or uploaded images.

What’s included
- scan.html — Main single-page UI.
- scanner.js — Scanner logic (ZXing + BarcodeDetector fallback, image preprocessing, multi-scan stability).
- style.css — Simple styling.

Notes and tips
- For best camera support use Chrome / Edge / Safari on macOS 12+.
- If the camera preview doesn't appear, check the site permissions and ensure you served the page over http(s) (file:// does not allow camera access).
- If ZXing fails to decode uploaded images, try cropping to the barcode region or use the camera to take a close, well-lit photo.

License
MIT — see LICENSE file.
