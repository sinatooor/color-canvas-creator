
import { Color, Hint } from '../types';
import {
  OUTLINE_DARKNESS_THRESHOLD,
  MIN_FILL_LUMINANCE,
  DARK_FILL_BOOST,
  BINARIZE_THRESHOLD,
  NOISE_NEIGHBOR_THRESHOLD,
  PALETTE_SAMPLE_STEP,
  PALETTE_K_MEANS_K,
  PALETTE_K_MEANS_MAX_ITERATIONS,
  PALETTE_BLACK_THRESHOLD,
  PALETTE_WHITE_THRESHOLD
} from '../constants';

/**
 * ARCHITECTURE IMPLEMENTATION: cv_and_vectorization.validation_checks
 * 
 * Auto-fix step to ensure:
 * 1. Outlines are pure black (or close to it)
 * 2. Fills are not too dark (Luminance > 30%)
 * 3. Noise is reduced
 */
export function validateAndFixFrame(imageData: ImageData): ImageData {
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // 1. Detect Outline vs Fill using OUTLINE_DARKNESS_THRESHOLD
    const isDark = r < OUTLINE_DARKNESS_THRESHOLD && g < OUTLINE_DARKNESS_THRESHOLD && b < OUTLINE_DARKNESS_THRESHOLD;
    
    if (isDark) {
       // Force to Pure Black for Potrace stability
       data[i] = 0;
       data[i+1] = 0;
       data[i+2] = 0;
    } else {
       // 2. Validate Fill Luminance (BT.601 luma formula)
       const lum = 0.299*r + 0.587*g + 0.114*b;
       
       // If fill is too dark (but not an outline), lighten it
       if (lum < MIN_FILL_LUMINANCE) {
           data[i] = Math.min(255, r + DARK_FILL_BOOST);
           data[i+1] = Math.min(255, g + DARK_FILL_BOOST);
           data[i+2] = Math.min(255, b + DARK_FILL_BOOST);
       }
    }
  }
  return imageData;
}

/**
 * Converts image data to strict Black and White (1-bit equivalent).
 * Uses Max Channel Value < threshold to identify lines.
 */
export function binarizeImageData(imageData: ImageData, threshold: number = BINARIZE_THRESHOLD): ImageData {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Max Channel logic: If any channel is bright enough, it's NOT a black line.
    const maxVal = Math.max(r, g, b);
    const value = maxVal < threshold ? 0 : 255;
    
    data[i] = value;     // R
    data[i + 1] = value; // G
    data[i + 2] = value; // B
    data[i + 3] = 255;   // Alpha
  }
  return imageData;
}

/**
 * Removes "salt and pepper" noise from the binary image.
 * Flips isolated black pixels to white and isolated white pixels to black.
 */
export function cleanupArtifacts(imageData: ImageData): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const copy = new Uint8ClampedArray(data); 
  
  const getVal = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 255; 
      return copy[(y * w + x) * 4];
  };

  for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const val = copy[idx];
          
          let neighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  if (getVal(x + dx, y + dy) === val) neighbors++;
              }
          }
          
          if (neighbors < NOISE_NEIGHBOR_THRESHOLD) {
              const newVal = val === 0 ? 255 : 0;
              data[idx] = newVal;
              data[idx+1] = newVal;
              data[idx+2] = newVal;
          }
      }
  }
  return imageData;
}

/**
 * Extracts a palette using K-Means Clustering.
 * Sorts by HSL Hue for better visual organization.
 */
/**
 * Extracts a palette using K-Means Clustering.
 * Sorts by HSL Hue for better visual organization.
 * 
 * PERFORMANCE: Uses PALETTE_SAMPLE_STEP for reduced sampling (default 1/100th).
 */
export function extractPalette(imageData: ImageData): Color[] {
  const data = imageData.data;
  const pixels: number[][] = [];
  
  // 1. Sampling Step: Don't process every pixel for speed.
  // Uses PALETTE_SAMPLE_STEP constant (1/100th of image is statistically sufficient)
  for (let i = 0; i < data.length; i += 4 * PALETTE_SAMPLE_STEP) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Skip dark outlines and near-white backgrounds using constants
    if (r < PALETTE_BLACK_THRESHOLD && g < PALETTE_BLACK_THRESHOLD && b < PALETTE_BLACK_THRESHOLD) continue;
    if (r > PALETTE_WHITE_THRESHOLD && g > PALETTE_WHITE_THRESHOLD && b > PALETTE_WHITE_THRESHOLD) continue;

    pixels.push([r, g, b]);
  }

  if (pixels.length === 0) return [{ name: 'Blue', hex: '#3b82f6' }];

  // 2. K-Means Algorithm with constants
  // Initialize centroids randomly
  let centroids: number[][] = [];
  for (let i = 0; i < PALETTE_K_MEANS_K; i++) {
     centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
  }

  for (let iter = 0; iter < PALETTE_K_MEANS_MAX_ITERATIONS; iter++) {
      // Assignment step
      const clusters: number[][][] = Array.from({ length: PALETTE_K_MEANS_K }, () => []);

      // PERFORMANCE: Early exit for pixels if sample is large
      const pixelCount = pixels.length;
      for (let i = 0; i < pixelCount; i++) {
          const p = pixels[i];
          let minDist = Infinity;
          let bestK = 0;
          const p0 = p[0], p1 = p[1], p2 = p[2]; // Cache for performance
          
          for (let j = 0; j < PALETTE_K_MEANS_K; j++) {
              const c = centroids[j];
              // Inline squared distance calculation (avoid Math.pow for speed)
              const dr = p0 - c[0];
              const dg = p1 - c[1];
              const db = p2 - c[2];
              const dist = dr * dr + dg * dg + db * db;
              if (dist < minDist) {
                  minDist = dist;
                  bestK = j;
              }
          }
          clusters[bestK].push(p);
      }

      // Update step
      let changed = false;
      const newCentroids: number[][] = [];
      for (let j = 0; j < PALETTE_K_MEANS_K; j++) {
          const cluster = clusters[j];
          if (cluster.length === 0) {
              // If cluster empty, keep old centroid or re-init
              newCentroids.push(centroids[j]);
              continue;
          }
          
          let sumR=0, sumG=0, sumB=0;
          for(const p of cluster) {
              sumR += p[0];
              sumG += p[1];
              sumB += p[2];
          }
          const newC = [Math.round(sumR/cluster.length), Math.round(sumG/cluster.length), Math.round(sumB/cluster.length)];
          
          // Check convergence
          if (Math.abs(newC[0]-centroids[j][0]) > 1 || Math.abs(newC[1]-centroids[j][1]) > 1) {
              changed = true;
          }
          newCentroids.push(newC);
      }
      centroids = newCentroids;
      if (!changed) break;
  }

  // 3. Format result
  const uniqueHexes = new Set<string>();
  const palette: Color[] = [];

  centroids.forEach(c => {
      const hex = rgbToHex(c[0], c[1], c[2]);
      if (!uniqueHexes.has(hex)) {
          uniqueHexes.add(hex);
          palette.push({ name: hex, hex });
      }
  });
  
  // Sort by HSL (Hue)
  palette.sort((a, b) => {
      const hslA = hexToHSL(a.hex);
      const hslB = hexToHSL(b.hex);
      // Sort primarily by Hue, then by Lightness
      if (Math.abs(hslA.h - hslB.h) > 5) return hslA.h - hslB.h;
      return hslB.l - hslA.l;
  });

  return palette;
}

function hexToHSL(hex: string) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s, l };
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
