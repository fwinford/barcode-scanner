Scanner — Package Tracking Barcode Scanner

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
