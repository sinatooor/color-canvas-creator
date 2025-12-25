
import { PotraceLib } from '../types';

declare const Potrace: PotraceLib;

export async function vectorizeImage(base64Image: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      if (typeof Potrace === 'undefined') {
        console.warn('Potrace library not loaded, returning original image.');
        resolve(base64Image);
        return;
      }

      // --- STEP 1: Pre-process the image to extract ONLY strict outlines ---
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = base64Image;
      
      await new Promise((r) => { img.onload = r; });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
          throw new Error("Could not initialize canvas for pre-processing");
      }

      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // CRITICAL UPDATE: Strict Threshold = 20
      // Any pixel with a channel > 20 is considered a "Color" and removed (turned white).
      // Only pixels where R, G, and B are ALL < 20 are kept as "Lines".
      // This prevents dark colors (e.g. RGB 40, 20, 20) from becoming black blobs.
      const THRESHOLD = 20; 

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        const maxVal = Math.max(r, g, b);

        if (maxVal < THRESHOLD) {
            // It is a Line (Keep Black)
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            // Alpha 255
        } else {
            // It is a Fill (Remove -> White)
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
        }
      }

      // Put the "Line Art Only" data back
      ctx.putImageData(imageData, 0, 0);
      const cleanBase64 = canvas.toDataURL('image/png');

      // --- STEP 2: Vectorize the Clean Lines ---

      Potrace.setParameter({
        turdsize: 80,     // Despeckle
        optcurve: true,   // Smooth curves
        alphamax: 1,      // Smooth corners
        blacklevel: 0.5   // Standard threshold since input is now pre-processed binary
      });

      Potrace.loadImageFromUrl(cleanBase64);
      
      Potrace.process(() => {
        try {
          const svgContent = Potrace.getSVG(1);
          const svgBase64 = btoa(svgContent);
          resolve(`data:image/svg+xml;base64,${svgBase64}`);
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      console.error("Vectorization failed:", err);
      resolve(base64Image);
    }
  });
}
