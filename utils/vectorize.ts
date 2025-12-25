
import { PotraceLib } from '../types';

// Helper to access Potrace globally
const getPotrace = (): PotraceLib | undefined => {
  return (window as any).Potrace;
};

// Fallback loader in case index.html script fails or hasn't loaded
async function ensurePotraceLoaded(): Promise<PotraceLib> {
  if ((window as any).Potrace) {
    return (window as any).Potrace;
  }

  return new Promise((resolve, reject) => {
    console.log("Potrace not found, attempting dynamic load...");
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/gh/kilobtye/potrace@master/potrace.js';
    script.onload = () => {
      if ((window as any).Potrace) {
        console.log("Potrace loaded successfully.");
        resolve((window as any).Potrace);
      } else {
        reject(new Error("Potrace loaded but global object missing"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load Potrace library"));
    document.head.appendChild(script);
  });
}

interface VectorizationResult {
  outlines: string; // The black lines (visual overlay)
  regions: string;  // The filled regions (clickable layer)
}

export async function vectorizeImage(base64Image: string): Promise<VectorizationResult> {
  return new Promise(async (resolve, reject) => {
    try {
      const Potrace = await ensurePotraceLoaded();

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = base64Image;
      
      await new Promise((r) => { img.onload = r; });

      const width = img.width;
      const height = img.height;

      // --- HELPER: Process Canvas Layer ---
      const processLayer = (mode: 'lines' | 'regions'): Promise<string> => {
        return new Promise((resolveLayer) => {
             // 1. Create Canvas & Process Image Data
             const canvas = document.createElement('canvas');
             canvas.width = width;
             canvas.height = height;
             const ctx = canvas.getContext('2d');
             if (!ctx) throw new Error("Canvas error");
             
             ctx.drawImage(img, 0, 0);
             const imageData = ctx.getImageData(0, 0, width, height);
             const data = imageData.data;
             const THRESHOLD = 30;

             // Thresholding
             for (let i = 0; i < data.length; i += 4) {
               const maxVal = Math.max(data[i], data[i+1], data[i+2]);
               // If dark, it's a line (0). If light, it's space (255).
               const val = maxVal < THRESHOLD ? 0 : 255;
               data[i] = data[i+1] = data[i+2] = val;
               data[i+3] = 255;
             }
             ctx.putImageData(imageData, 0, 0);

             if (mode === 'regions') {
                 // Dilate (Thicken black lines) strongly to separate white regions
                 // Increasing blur radius makes lines effectively thicker
                 ctx.filter = 'blur(2.5px)'; 
                 ctx.drawImage(canvas, 0, 0);
                 ctx.filter = 'none';
                 
                 const dilatedData = ctx.getImageData(0, 0, width, height);
                 const dData = dilatedData.data;
                 for (let i = 0; i < dData.length; i += 4) {
                      // Invert for Potrace: We want to trace the White Regions, so we make them Black.
                      // The blur makes lines gray. Any gray < 240 is treated as line (black).
                      // This effectively expands the "line" area significantly.
                      const val = dData[i] < 240 ? 0 : 255; 
                      const invertedVal = val === 255 ? 0 : 255;
                      dData[i] = dData[i+1] = dData[i+2] = invertedVal;
                      dData[i+3] = 255;
                 }
                 ctx.putImageData(dilatedData, 0, 0);
             }

             // 2. Trace
             const source = canvas.toDataURL('image/png');
             
             // Important: Lower turdsize for lines to catch fine details
             Potrace.setParameter({
                turdsize: mode === 'regions' ? 40 : 10, 
                optcurve: true,
                alphamax: 1,
                blacklevel: 0.5
             });

             Potrace.loadImageFromUrl(source);
             Potrace.process(() => {
                 resolveLayer(Potrace.getSVG(1));
             });
        });
      };

      // Execute sequentially to avoid singleton state conflict
      const outlinesSVG = await processLayer('lines');
      const regionsSVG = await processLayer('regions');

      const toBase64 = (svgStr: string) => `data:image/svg+xml;base64,${btoa(svgStr)}`;

      resolve({
          outlines: toBase64(outlinesSVG),
          regions: toBase64(regionsSVG)
      });

    } catch (err) {
      console.error("Vectorization failed:", err);
      reject(err);
    }
  });
}
