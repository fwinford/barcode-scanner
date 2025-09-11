Scanner — Package Tracking Barcode Scanner

This is a small static web app that uses ZXing and the browser BarcodeDetector (when available) to scan package tracking barcodes from a camera (including iPhone Continuity Camera) or uploaded images.

What’s included
- scan.html — Main single-page UI.
- scanner.js — Scanner logic (ZXing + BarcodeDetector fallback, image preprocessing, multi-scan stability).
- style.css — Simple styling.

Quick local preview
1. From the project folder run one of these commands to serve the files locally (macOS / Linux):

   python3 -m http.server 8001

   or if you have Node.js installed:

   npx http-server -p 8001

2. Open http://localhost:8001/scan.html in a browser that supports camera access.

Make it a Git repository and push to GitHub
1. Initialize and commit locally:

   git init
   git add .
   git commit -m "Initial import: scanner web app"

2. Create a GitHub repo and push. Replace <owner> and <repo>:

   git remote add origin git@github.com:<owner>/<repo>.git
   git branch -M main
   git push -u origin main

Optional: use GitHub CLI to create and push in one step (if you have gh installed):

   gh repo create <owner>/<repo> --public --source=. --remote=origin --push

Notes and tips
- For best camera support use Chrome / Edge / Safari on macOS 12+.
- If the camera preview doesn't appear, check the site permissions and ensure you served the page over http(s) (file:// does not allow camera access).
- If ZXing fails to decode uploaded images, try cropping to the barcode region or use the camera to take a close, well-lit photo.

License
MIT — see LICENSE file.
