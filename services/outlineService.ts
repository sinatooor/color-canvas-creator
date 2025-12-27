
import { vectorizeImageData, VectorizationOptions } from '../utils/vectorize';
import { OutlineThickness } from '../types';
import { MEDIAN_FILTER_THRESHOLD, DESPECKLE_MIN_SIZE } from '../constants';
import type { AdvancedSettings } from '../stores/advancedSettings';

// Optional settings override for advanced mode
export interface OutlineSettings {
  medianFilterThreshold?: number;
  despeckleMinSize?: number;
  gapClosingRadius?: number;
  edgeBorderWidth?: number;
  // SVG Vectorization options
  svgLineSmoothness?: number;
  svgCurveSmoothness?: number;
  svgPathOmit?: number;
  svgRoundCoords?: number;
}

/**
 * OutlineMakerService Module
 * Scope: Process B&W coloring page input -> Skeletonize -> Thicken -> Vectorize
 */
export const outlineService = {
  
  /**
   * Main Pipeline:
   * 1. Threshold & Cleanup (Median Filter)
   * 2. Despeckle (Remove small noise)
   * 3. Skeletonize (Thin to 1px)
   * 4. Controlled Thickening (Dilate to target width based on settings)
   * 5. Vectorize (Output SVG)
   */
  async generateLeakProofOutlines(imageData: ImageData, thickness: OutlineThickness = 'medium', settings?: OutlineSettings): Promise<string> {
    const width = imageData.width;
    const height = imageData.height;

    // Generate the master mask with specific thickness
    const mask = computeCleanMask(imageData, thickness, settings);

    // Convert Mask back to ImageData for Vectorizer
    // Must be strictly 0 (black) or 255 (white)
    const cleanImage = new ImageData(width, height);
    for (let i = 0; i < width * height; i++) {
        const val = mask[i] === 1 ? 0 : 255;
        const idx = i * 4;
        cleanImage.data[idx] = val;
        cleanImage.data[idx+1] = val;
        cleanImage.data[idx+2] = val;
        cleanImage.data[idx+3] = 255; // Alpha opaque
    }

    // Build SVG vectorization options from settings
    const svgOptions: VectorizationOptions = {
      lineSmoothness: settings?.svgLineSmoothness,
      curveSmoothness: settings?.svgCurveSmoothness,
      pathOmit: settings?.svgPathOmit,
      roundCoords: settings?.svgRoundCoords,
    };

    // Vectorize with options
    const vectorResult = await vectorizeImageData(cleanImage, svgOptions);
    return vectorResult.outlines;
  },

  /**
   * Returns a repaired ImageData object for the Fill Engine (Label Map).
   * It uses the exact same mask logic as the outlines to ensure 1:1 registration.
   */
  processAndRepairImage(imageData: ImageData, thickness: OutlineThickness = 'medium', settings?: OutlineSettings): ImageData {
      const width = imageData.width;
      const height = imageData.height;
      
      const mask = computeCleanMask(imageData, thickness, settings);

      const output = new ImageData(width, height);
      for (let i = 0; i < width * height; i++) {
          const val = mask[i] === 1 ? 0 : 255;
          const idx = i * 4;
          output.data[idx] = val;
          output.data[idx+1] = val;
          output.data[idx+2] = val;
          output.data[idx+3] = 255;
      }
      return output;
  }
};

/** Thickness radius lookup table */
const THICKNESS_RADIUS: Record<OutlineThickness, number> = {
  thin: 1,    // Approx 2px line
  medium: 2,  // Approx 4px line
  thick: 3,   // Approx 6px line
  heavy: 5    // Approx 10px line
};

/**
 * Central Logic: Computes the binary wall mask from the input image.
 * SIMPLIFIED: Less aggressive processing to preserve original outlines better.
 * @param settings Optional settings override for advanced mode tuning.
 */
function computeCleanMask(imageData: ImageData, thickness: OutlineThickness, settings?: OutlineSettings): Uint8Array {
    const width = imageData.width;
    const height = imageData.height;

    const medianThreshold = settings?.medianFilterThreshold ?? MEDIAN_FILTER_THRESHOLD;
    const despeckleSize = settings?.despeckleMinSize ?? DESPECKLE_MIN_SIZE;
    const gapRadius = settings?.gapClosingRadius ?? 1;
    const edgeBorderWidth = settings?.edgeBorderWidth ?? 2;

    // 1. Direct threshold from image - no median filter to preserve outline fidelity
    let mask = directThreshold(imageData, medianThreshold);
    
    // 2. Light despeckle - only remove tiny noise specks
    mask = removeSmallComponents(mask, width, height, despeckleSize); 

    // 3. Skip skeletonization to preserve original line widths
    // Only apply minimal thickening if needed for gap closing
    
    // 4. Small gap closing only
    if (gapRadius > 0) {
      mask = morphDilateCircular(mask, width, height, gapRadius);
      mask = morphErodeCircular(mask, width, height, gapRadius);
    }

    // 5. Add edge border to prevent leakage at image boundaries
    if (edgeBorderWidth > 0) {
      mask = addEdgeBorder(mask, width, height, edgeBorderWidth);
    }

    return mask;
}

/**
 * Adds a solid border around the edges of the mask to prevent color leakage
 * where lines don't reach the image edge.
 */
function addEdgeBorder(mask: Uint8Array, width: number, height: number, borderWidth: number): Uint8Array {
    const output = new Uint8Array(mask);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Check if pixel is within border region
            if (x < borderWidth || x >= width - borderWidth || 
                y < borderWidth || y >= height - borderWidth) {
                output[y * width + x] = 1; // Mark as wall
            }
        }
    }
    
    return output;
}

/**
 * Simple threshold without median filter to preserve original outlines.
 */
function directThreshold(imageData: ImageData, threshold: number = MEDIAN_FILTER_THRESHOLD): Uint8Array {
    const { width, height, data } = imageData;
    const output = new Uint8Array(width * height);
    
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        // Use max channel as luminance proxy (more lenient)
        const maxChannel = Math.max(r, g, b);
        
        // Wall if pixel is dark enough
        output[i] = maxChannel < threshold ? 1 : 0;
    }
    
    return output;
}

/**
 * 3x3 Median Filter to remove noise while preserving edges.
 * Returns binary mask (1=Black/Wall, 0=White/Empty).
 * PERFORMANCE: Insertion sort for 9 elements is faster than Array.sort()
 */
function applyMedianFilter(imageData: ImageData): Uint8Array {
    const { width, height, data } = imageData;
    const output = new Uint8Array(width * height);
    
    // Pre-calculate offsets for 3x3 kernel (avoids repeated multiplication)
    const getVal = (x: number, y: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return 255;
        return data[(y * width + x) * 4 + 1]; // Green channel as grayscale proxy
    };

    // Reusable array for median calculation (avoid allocation in loop)
    const vals = new Uint8Array(9);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Collect 3x3 neighborhood
            let idx = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    vals[idx++] = getVal(x + dx, y + dy);
                }
            }
            
            // Inline insertion sort for 9 elements (faster than Array.sort for small n)
            for (let i = 1; i < 9; i++) {
                const key = vals[i];
                let j = i - 1;
                while (j >= 0 && vals[j] > key) {
                    vals[j + 1] = vals[j];
                    j--;
                }
                vals[j + 1] = key;
            }
            
            // Threshold: < MEDIAN_FILTER_THRESHOLD is Black (Wall=1)
            output[y * width + x] = vals[4] < MEDIAN_FILTER_THRESHOLD ? 1 : 0;
        }
    }
    return output;
}

/**
 * Connected Component analysis to remove small specks.
 */
function removeSmallComponents(mask: Uint8Array, width: number, height: number, minSize: number): Uint8Array {
    const labels = new Int32Array(width * height).fill(0);
    const output = new Uint8Array(mask); // Copy
    let currentLabel = 1;
    const sizes: Record<number, number> = {};

    // 1. Label components
    for (let i = 0; i < width * height; i++) {
        if (mask[i] === 1 && labels[i] === 0) {
            // Start Fill
            const stack = [i];
            labels[i] = currentLabel;
            let count = 0;
            
            while(stack.length > 0) {
                const idx = stack.pop()!;
                count++;
                
                const x = idx % width;
                const y = Math.floor(idx / width);

                // 4-connectivity (inline for speed)
                if (x > 0 && mask[idx-1] === 1 && labels[idx-1] === 0) { labels[idx-1] = currentLabel; stack.push(idx-1); }
                if (x < width-1 && mask[idx+1] === 1 && labels[idx+1] === 0) { labels[idx+1] = currentLabel; stack.push(idx+1); }
                if (y > 0 && mask[idx-width] === 1 && labels[idx-width] === 0) { labels[idx-width] = currentLabel; stack.push(idx-width); }
                if (y < height-1 && mask[idx+width] === 1 && labels[idx+width] === 0) { labels[idx+width] = currentLabel; stack.push(idx+width); }
            }
            sizes[currentLabel] = count;
            currentLabel++;
        }
    }

    // 2. Remove small ones
    for (let i = 0; i < width * height; i++) {
        if (mask[i] === 1) {
            const label = labels[i];
            if (sizes[label] < minSize) {
                output[i] = 0; // Turn to White
            }
        }
    }

    return output;
}

/**
 * Zhang-Suen Thinning Algorithm.
 * Iteratively erodes boundary pixels until only a 1px skeleton remains.
 */
function skeletonize(mask: Uint8Array, width: number, height: number): Uint8Array {
    const tempMask = new Uint8Array(mask);
    let changed = true;
    
    // Helpers
    const get = (x: number, y: number, m: Uint8Array) => {
        if (x<0 || y<0 || x>=width || y>=height) return 0;
        return m[y*width+x];
    };

    while (changed) {
        changed = false;
        const markers: number[] = [];

        // Sub-iteration 1
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (get(x, y, tempMask) === 0) continue;

                // P2, P3, ... P9
                const p2 = get(x, y-1, tempMask);
                const p3 = get(x+1, y-1, tempMask);
                const p4 = get(x+1, y, tempMask);
                const p5 = get(x+1, y+1, tempMask);
                const p6 = get(x, y+1, tempMask);
                const p7 = get(x-1, y+1, tempMask);
                const p8 = get(x-1, y, tempMask);
                const p9 = get(x-1, y-1, tempMask);

                const B = p2+p3+p4+p5+p6+p7+p8+p9;
                if (B < 2 || B > 6) continue;

                let A = 0;
                if (p2 === 0 && p3 === 1) A++;
                if (p3 === 0 && p4 === 1) A++;
                if (p4 === 0 && p5 === 1) A++;
                if (p5 === 0 && p6 === 1) A++;
                if (p6 === 0 && p7 === 1) A++;
                if (p7 === 0 && p8 === 1) A++;
                if (p8 === 0 && p9 === 1) A++;
                if (p9 === 0 && p2 === 1) A++;

                if (A !== 1) continue;

                if (p2 * p4 * p6 !== 0) continue;
                if (p4 * p6 * p8 !== 0) continue;

                markers.push(y * width + x);
            }
        }

        if (markers.length > 0) {
            for (const idx of markers) tempMask[idx] = 0;
            changed = true;
            markers.length = 0;
        }

        // Sub-iteration 2
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (get(x, y, tempMask) === 0) continue;

                const p2 = get(x, y-1, tempMask);
                const p3 = get(x+1, y-1, tempMask);
                const p4 = get(x+1, y, tempMask);
                const p5 = get(x+1, y+1, tempMask);
                const p6 = get(x, y+1, tempMask);
                const p7 = get(x-1, y+1, tempMask);
                const p8 = get(x-1, y, tempMask);
                const p9 = get(x-1, y-1, tempMask);

                const B = p2+p3+p4+p5+p6+p7+p8+p9;
                if (B < 2 || B > 6) continue;

                let A = 0;
                if (p2 === 0 && p3 === 1) A++;
                if (p3 === 0 && p4 === 1) A++;
                if (p4 === 0 && p5 === 1) A++;
                if (p5 === 0 && p6 === 1) A++;
                if (p6 === 0 && p7 === 1) A++;
                if (p7 === 0 && p8 === 1) A++;
                if (p8 === 0 && p9 === 1) A++;
                if (p9 === 0 && p2 === 1) A++;

                if (A !== 1) continue;

                if (p2 * p4 * p8 !== 0) continue;
                if (p2 * p6 * p8 !== 0) continue;

                markers.push(y * width + x);
            }
        }

        if (markers.length > 0) {
            for (const idx of markers) tempMask[idx] = 0;
            changed = true;
        }
    }

    return tempMask;
}

// --- Smooth Circular Morphology ---

function morphDilateCircular(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
    const output = new Uint8Array(input.length);
    const rSq = radius * radius;
    const ceilRadius = Math.ceil(radius);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (input[idx] === 1) { 
                output[idx] = 1; 
                continue; 
            }
            
            let hit = false;
            search:
            for (let dy = -ceilRadius; dy <= ceilRadius; dy++) {
                for (let dx = -ceilRadius; dx <= ceilRadius; dx++) {
                    // Circular check
                    if (dx*dx + dy*dy <= rSq) {
                        const ny = y + dy;
                        const nx = x + dx;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            if (input[ny * width + nx] === 1) { 
                                hit = true; 
                                break search; 
                            }
                        }
                    }
                }
            }
            if (hit) output[idx] = 1;
        }
    }
    return output;
}

function morphErodeCircular(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
    const output = new Uint8Array(input.length);
    const rSq = radius * radius;
    const ceilRadius = Math.ceil(radius);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (input[idx] === 0) { 
                output[idx] = 0; 
                continue; 
            }
            
            let keep = true;
            search:
            for (let dy = -ceilRadius; dy <= ceilRadius; dy++) {
                for (let dx = -ceilRadius; dx <= ceilRadius; dx++) {
                    // Circular check
                    if (dx*dx + dy*dy <= rSq) {
                        const ny = y + dy;
                        const nx = x + dx;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            if (input[ny * width + nx] === 0) { 
                                keep = false; 
                                break search; 
                            }
                        }
                    }
                }
            }
            output[idx] = keep ? 1 : 0;
        }
    }
    return output;
}
