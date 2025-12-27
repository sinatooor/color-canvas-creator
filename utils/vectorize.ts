
interface VectorizationResult {
  outlines: string; 
  regions: string;  
}

export interface VectorizationOptions {
  lineSmoothness?: number;    // ltres: 0.1-2, default 0.5
  curveSmoothness?: number;   // qtres: 0.1-2, default 0.5
  pathOmit?: number;          // pathomit: 0-100, default 0
  roundCoords?: number;       // roundcoords: 0-3, default 1
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

// New signature handling ImageData directly with configurable options
export async function vectorizeImageData(
  imageData: ImageData, 
  options: VectorizationOptions = {}
): Promise<VectorizationResult> {
    try {
        const ImageTracer = await ensureImageTracerLoaded();

        // Apply defaults
        const lineSmoothness = options.lineSmoothness ?? 0.5;
        const curveSmoothness = options.curveSmoothness ?? 0.5;
        const pathOmit = options.pathOmit ?? 0;
        const roundCoords = options.roundCoords ?? 1;

        // 1. Force the input data to be strictly Opaque to avoid alpha confusion
        const cleanData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
        for(let i=0; i<cleanData.data.length; i+=4) {
            cleanData.data[i+3] = 255; 
        }

        // 2. Configuration optimized for vectorizing thin black outlines
        const tracerOptions = {
            // Processing
            corsenabled: false,
            // Smoothness thresholds - configurable
            ltres: lineSmoothness,
            qtres: curveSmoothness,
            // Path omit threshold - configurable (0 = keep all thin lines)
            pathomit: pathOmit,
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
            
            // Coordinate rounding - configurable
            roundcoords: roundCoords,
            
            // Palette (Strict B/W)
            pal: [{r:0,g:0,b:0,a:255}, {r:255,g:255,b:255,a:255}]
        };

        // 3. Generate SVG
        const svgStr = ImageTracer.imagedataToSVG(cleanData, tracerOptions);

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

        // Build an outline-only SVG by stroking every traced path.
        // This avoids "white on white" failures when ImageTracer outputs unexpected fill colors.
        const outlines = createNewSvg();
        let keptPaths = 0;

        // Use a bolder default stroke so outlines remain visible at normal zoom.
        const strokeWidth = 2;

        paths.forEach((p) => {
            const clone = outlines.doc.importNode(p, true) as SVGElement;

            // Force visible ink regardless of original fill.
            clone.setAttribute('fill', 'none');
            clone.setAttribute('stroke', '#0b0b0b');
            clone.setAttribute('stroke-opacity', '1');
            clone.setAttribute('stroke-width', String(strokeWidth));
            clone.setAttribute('stroke-linecap', 'round');
            clone.setAttribute('stroke-linejoin', 'round');
            // Keep stroke width consistent when zooming the editor canvas
            clone.setAttribute('vector-effect', 'non-scaling-stroke');

            outlines.svg.appendChild(clone);
            keptPaths++;
        });

        // If for some reason we got zero paths, fall back to the raw traced SVG.
        const s = new XMLSerializer();
        const outputSvg = keptPaths > 0 ? s.serializeToString(outlines.doc) : svgStr;
        if (keptPaths === 0) {
            console.warn('vectorizeImageData: no paths detected; returning unfiltered SVG');
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
