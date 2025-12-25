
import { PotraceLib } from '../types';

declare const Potrace: PotraceLib;

export async function vectorizeImage(base64Image: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof Potrace === 'undefined') {
        console.warn('Potrace library not loaded, returning original image.');
        resolve(base64Image);
        return;
      }

      // Configure Potrace for "Winning App" quality
      Potrace.setParameter({
        turdsize: 100,    // Aggressive speckle removal: Filter out noise (specks smaller than 100px area)
        optcurve: true,    // optimize curves
        alphamax: 1,       // smooth corners
        blacklevel: 0.3    // Threshold for determining what is black vs color. 
                           // 0.3 is balanced to catch lines but avoid turning dark colors into black blobs.
      });

      // Load image into Potrace
      Potrace.loadImageFromUrl(base64Image);
      
      // Process
      Potrace.process(() => {
        try {
          // Get SVG string
          // scaling factor 1 keeps it relative to original image size
          const svgContent = Potrace.getSVG(1);
          
          // Wrap it to ensure it's a valid standalone SVG data URI
          // Potrace outputs a bare <svg> tag.
          
          const svgBase64 = btoa(svgContent);
          resolve(`data:image/svg+xml;base64,${svgBase64}`);
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      console.error("Vectorization failed:", err);
      // Fallback to original image if vectorization fails
      resolve(base64Image);
    }
  });
}
