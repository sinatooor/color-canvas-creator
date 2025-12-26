
interface VectorizationResult {
  outlines: string; 
  regions: string;  
}

// Fallback loader for ImageTracer
async function ensureImageTracerLoaded(): Promise<any> {
  if ((window as any).ImageTracer) {
    return (window as any).ImageTracer;
  }

  return new Promise((resolve, reject) => {
    // Check if script is already present
    if (document.querySelector('script[src*="imagetracer"]')) {
         let checks = 0;
         const interval = setInterval(() => {
             if ((window as any).ImageTracer) {
                 clearInterval(interval);
                 resolve((window as any).ImageTracer);
             }
             if (checks++ > 20) {
                 clearInterval(interval);
                 reject(new Error("ImageTracer timeout"));
             }
         }, 200);
         return;
    }

    console.log("ImageTracer not found, attempting dynamic load...");
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.min.js';
    script.onload = () => {
      if ((window as any).ImageTracer) {
        resolve((window as any).ImageTracer);
      } else {
        reject(new Error("ImageTracer loaded but global object missing"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load ImageTracer library"));
    document.head.appendChild(script);
  });
}

// New signature handling ImageData directly
export async function vectorizeImageData(imageData: ImageData): Promise<VectorizationResult> {
    try {
        const ImageTracer = await ensureImageTracerLoaded();

        // 1. Force the input data to be strictly Opaque to avoid alpha confusion
        const cleanData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
        for(let i=0; i<cleanData.data.length; i+=4) {
            cleanData.data[i+3] = 255; 
        }

        // 2. Configuration optimized for vectorizing thin black outlines
        // NOTE: If pathomit is too high, thin lines can disappear completely.
        const options = {
            // Processing
            corsenabled: false,
            // Lower thresholds preserve more detail
            ltres: 0.5,
            qtres: 0.5,
            // CRITICAL: do not omit small paths (thin outlines)
            pathomit: 0,
            rightangleenhance: false,
            
            // Colors
            colorsampling: 0,   // Deterministic
            numberofcolors: 2,  // Black & White only
            mincolorratio: 0,
            colorquantcycles: 0,
            
            // Styling
            strokewidth: 0,
            linefilter: false,
            scale: 1,
            viewbox: true,
            desc: false,
            
            // Rounding helps smooth out sub-pixel jitter
            roundcoords: 1,
            
            // Palette (Strict B/W)
            pal: [{r:0,g:0,b:0,a:255}, {r:255,g:255,b:255,a:255}]
        };

        // 3. Generate SVG
        const svgStr = ImageTracer.imagedataToSVG(cleanData, options);

        // 4. Post-process to extract ONLY Black paths
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgStr, 'image/svg+xml');
        const paths = Array.from(doc.querySelectorAll('path'));

        const width = imageData.width;
        const height = imageData.height;

        const createNewSvg = () => {
            const newDoc = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null);
            const svg = newDoc.documentElement; 
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
            svg.setAttribute('width', `${width}`);
            svg.setAttribute('height', `${height}`);
            // Ensure SVG doesn't capture clicks, letting them fall through to canvas
            svg.setAttribute('style', 'pointer-events: none;'); 
            return { doc: newDoc, svg };
        };

        const outlines = createNewSvg();
        let keptPaths = 0;

        paths.forEach(p => {
            let fill = p.getAttribute('fill');
            if (!fill && (p as any).style?.fill) fill = (p as any).style.fill;
            if (!fill) fill = 'rgb(0,0,0)'; // Default

            // Robust color detection
            // ImageTracer outputs RGB(r,g,b).
            // We want the lines. In our binary map, 0 is Black (Lines).
            // So we want paths that are closer to Black than White.
            let isDark = false;

            // Check for RGB format
            if (fill.startsWith('rgb')) {
                const rgb = fill.match(/\d+/g);
                if (rgb && rgb.length >= 3) {
                    const r = parseInt(rgb[0]);
                    const g = parseInt(rgb[1]);
                    const b = parseInt(rgb[2]);
                    isDark = (r + g + b) / 3 < 180;
                }
            }
            else if (fill.startsWith('#')) {
                const hex = fill.replace('#', '');
                if (hex.length === 6) {
                    const r = parseInt(hex.substring(0, 2), 16);
                    const g = parseInt(hex.substring(2, 4), 16);
                    const b = parseInt(hex.substring(4, 6), 16);
                    isDark = (r + g + b) / 3 < 180;
                } else if (hex.length === 3) {
                     const r = parseInt(hex[0]+hex[0], 16);
                     const g = parseInt(hex[1]+hex[1], 16);
                     const b = parseInt(hex[2]+hex[2], 16);
                     isDark = (r + g + b) / 3 < 180;
                }
            }
            else if (fill.toLowerCase() === 'black') {
                isDark = true;
            }

            // FILTER:
            // Dark paths = Opaque (Visible)
            // Light paths = Hidden
            if (isDark) {
                const clone = outlines.doc.importNode(p, true) as SVGElement;
                clone.setAttribute('fill', '#000000');
                clone.setAttribute('fill-opacity', '1');
                clone.style.stroke = 'none';
                outlines.svg.appendChild(clone);
                keptPaths++;
            }
        });

        // If we somehow filtered everything out, fall back to the raw traced SVG.
        // This prevents the editor from showing a blank canvas.
        const s = new XMLSerializer();
        const outputSvg = keptPaths > 0 ? s.serializeToString(outlines.doc) : svgStr;
        if (keptPaths === 0) {
            console.warn('vectorizeImageData: no dark paths detected; returning unfiltered SVG');
        }

        const toBase64 = (str: string) => window.btoa(unescape(encodeURIComponent(str)));

        return {
            outlines: `data:image/svg+xml;base64,${toBase64(outputSvg)}`,
            regions: ""
        };

    } catch (err) {
        console.error("Vectorization failed:", err);
        throw err;
    }
}

export async function vectorizeImage(base64Image: string): Promise<VectorizationResult> {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = base64Image;
      await new Promise((r) => { img.onload = r; });
      
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if(!ctx) throw new Error("Context failed");
      ctx.drawImage(img, 0, 0);
      
      return vectorizeImageData(ctx.getImageData(0,0, img.width, img.height));
}
