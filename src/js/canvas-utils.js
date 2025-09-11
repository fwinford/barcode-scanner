export class CanvasUtils {
  constructor() {
    this.dpr = window.devicePixelRatio || 1;
  }

  fitCanvasToBox(canvas, cssWidth, cssHeight) {
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    canvas.width = Math.round(cssWidth * this.dpr);
    canvas.height = Math.round(cssHeight * this.dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // Reverted to original: always create 600x400 preview that fully fits entire image
  async loadImageToCanvas(canvas, file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const previewW = 600;
        const previewH = 400;
        canvas.style.width = previewW + 'px';
        canvas.style.height = previewH + 'px';
        canvas.width = Math.round(previewW * this.dpr);
        canvas.height = Math.round(previewH * this.dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const imgRatio = img.width / img.height;
        const previewRatio = previewW / previewH;
        let drawW, drawH, drawX, drawY;
        if (imgRatio > previewRatio) { // wider
          drawW = previewW;
          drawH = previewW / imgRatio;
          drawX = 0;
          drawY = (previewH - drawH) / 2;
        } else { // taller
          drawH = previewH;
          drawW = previewH * imgRatio;
          drawX = (previewW - drawW) / 2;
          drawY = 0;
        }
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, previewW, previewH);
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        resolve();
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  }

  // Reverted: capture frame into 600x400 maintaining full frame visibility
  captureVideoFrame(video, canvas) {
    const previewW = 600;
    const previewH = 400;
    canvas.style.width = previewW + 'px';
    canvas.style.height = previewH + 'px';
    canvas.width = Math.round(previewW * this.dpr);
    canvas.height = Math.round(previewH * this.dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const videoRatio = (video.videoWidth || 640) / (video.videoHeight || 480);
    const previewRatio = previewW / previewH;
    let drawW, drawH, drawX, drawY;
    if (videoRatio > previewRatio) {
      drawW = previewW;
      drawH = previewW / videoRatio;
      drawX = 0;
      drawY = (previewH - drawH) / 2;
    } else {
      drawH = previewH;
      drawW = previewH * videoRatio;
      drawX = (previewW - drawW) / 2;
      drawY = 0;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, previewW, previewH);
    try { ctx.drawImage(video, drawX, drawY, drawW, drawH); } catch(e){ console.error(e); }
  }

  cropCanvas(sourceCanvas, cropData) {
    const out = document.createElement('canvas');
    out.width = Math.round(cropData.width);
    out.height = Math.round(cropData.height);
    const ctx = out.getContext('2d');
    ctx.drawImage(sourceCanvas, cropData.x, cropData.y, cropData.width, cropData.height, 0, 0, cropData.width, cropData.height);
    return out;
  }
}