
import { PotraceLib } from '../types';

declare const Potrace: PotraceLib;

interface VectorizationResult {
  outlines: string; // The black lines (visual overlay)
  regions: string;  // The filled regions (clickable layer)
}

export async function vectorizeImage(base64Image: string): Promise<VectorizationResult> {
  return new Promise(async (resolve, reject) => {
    try {
      if (typeof Potrace === 'undefined') {
        console.warn('Potrace library not loaded.');
        reject(new Error("Potrace not loaded"));
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = base64Image;
      
      await new Promise((r) => { img.onload = r; });

      const width = img.width;
      const height = img.height;

      // --- HELPER: Process Canvas ---
      const processCanvas = (mode: 'lines' | 'regions'): string => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Canvas error");

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const THRESHOLD = 30; // Strict threshold for lines

        // 1. Thresholding
        for (let i = 0; i < data.length; i += 4) {
          const maxVal = Math.max(data[i], data[i+1], data[i+2]);
          // If dark, it's a line (0). If light, it's space (255).
          const val = maxVal < THRESHOLD ? 0 : 255;
          data[i] = data[i+1] = data[i+2] = val;
          data[i+3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);

        if (mode === 'regions') {
            // 2. Dilation (Thicken black lines) to separate white regions
            // We use a simple blur + threshold trick to dilate the dark lines
            ctx.filter = 'blur(1.5px)'; // Blur spreads the black
            ctx.drawImage(canvas, 0, 0);
            ctx.filter = 'none';

            // Re-threshold to make it sharp binary again
            const dilatedData = ctx.getImageData(0, 0, width, height);
            const dData = dilatedData.data;
            for (let i = 0; i < dData.length; i += 4) {
                 // After blur, lines (0) spread into white (255). 
                 // Pixels that became grey (< 200) should join the line (become 0)
                 // This effectively shrinks the white regions, ensuring separation.
                 const val = dData[i] < 200 ? 0 : 255;
                 
                 // 3. INVERT for Potrace
                 // Potrace traces Black. We want it to trace the Regions (currently White).
                 // So we invert: Regions become Black, Lines become White.
                 const invertedVal = val === 255 ? 0 : 255;
                 
                 dData[i] = dData[i+1] = dData[i+2] = invertedVal;
                 dData[i+3] = 255;
            }
            ctx.putImageData(dilatedData, 0, 0);
        }

        // Generate SVG
        const source = canvas.toDataURL('image/png');
        Potrace.setParameter({
            turdsize: mode === 'regions' ? 40 : 100,
            optcurve: true,
            alphamax: 1,
            blacklevel: 0.5
        });
        
        Potrace.loadImageFromUrl(source);
        // Potrace is sync inside the process callback, but we need to wrap it
        let svg = '';
        Potrace.process(() => {
            svg = Potrace.getSVG(1);
        });
        return svg;
      };

      // --- EXECUTE ---
      // We need to run these sequentially or manage the Potrace global state carefully. 
      // Potrace JS is usually synchronous in 'process', but let's be safe.
      
      const outlinesSVG = processCanvas('lines');
      
      // Small delay to let UI breathe or reset Potrace state if needed (though instance is usually reset on load)
      setTimeout(() => {
          const regionsSVG = processCanvas('regions');
          
          // Helper to base64 encode SVG
          const toBase64 = (svgStr: string) => `data:image/svg+xml;base64,${btoa(svgStr)}`;
          
          resolve({
              outlines: toBase64(outlinesSVG),
              regions: toBase64(regionsSVG)
          });
      }, 50);

    } catch (err) {
      console.error("Vectorization failed:", err);
      reject(err);
    }
  });
}
