
import { Color, Hint } from '../types';

/**
 * Converts image data to strict Black and White (1-bit equivalent).
 * Uses a lower threshold to ensure only true black lines remain black.
 */
export function binarizeImageData(imageData: ImageData, threshold: number = 100): ImageData {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Calculate luminance
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    // Strict threshold
    const value = avg < threshold ? 0 : 255;
    
    data[i] = value;     // R
    data[i + 1] = value; // G
    data[i + 2] = value; // B
    data[i + 3] = 255;   // Alpha (Always opaque)
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
  const copy = new Uint8ClampedArray(data); // Read from copy, write to data
  
  // Helper to get pixel val from copy (0 or 255)
  const getVal = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 255; // Treat OOB as white (background)
      return copy[(y * w + x) * 4];
  };

  for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const val = copy[idx];
          
          // Count neighbors with same color (8-connectivity)
          let neighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  if (getVal(x + dx, y + dy) === val) neighbors++;
              }
          }
          
          // If isolated (less than 4 neighbors of same color), flip it
          // This removes single pixel noise and jagged 1px edges
          if (neighbors < 4) {
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
 * Checks if the image is fully colored by verifying that all hint locations
 * correspond to non-white pixels.
 */
export function checkProgress(imageData: ImageData, hints: Hint[]): boolean {
  if (hints.length === 0) return false;
  
  const data = imageData.data;
  const width = imageData.width;
  let uncoloredCount = 0;

  for (const hint of hints) {
    const idx = (hint.y * width + hint.x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // Check if the pixel at the hint location is still white (255, 255, 255)
    if (r > 240 && g > 240 && b > 240) {
      uncoloredCount++;
    }
  }

  // If very few hints remain uncolored (allowing for slight error), we consider it done.
  return uncoloredCount === 0;
}

/**
 * Extracts the top 64 colors from the image, excluding black/dark outlines and white/near-white.
 */
export function extractPalette(imageData: ImageData): Color[] {
  const data = imageData.data;
  const colorCounts = new Map<string, number>();

  // Sample every 4th pixel for performance
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Skip dark lines (approximating black)
    if (r < 50 && g < 50 && b < 50) continue;
    
    // Skip very light/white pixels (canvas background potentially)
    if (r > 240 && g > 240 && b > 240) continue;

    // Quantize colors to reduce noise (round to nearest 10)
    const qr = Math.round(r / 10) * 10;
    const qg = Math.round(g / 10) * 10;
    const qb = Math.round(b / 10) * 10;

    const hex = rgbToHex(qr, qg, qb);
    colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
  }

  // Sort by frequency
  const sortedColors = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => ({ name: hex, hex }));

  // Return top 64, or at least a fallback if empty
  if (sortedColors.length === 0) return [{ name: 'Blue', hex: '#3b82f6' }]; // Fallback
  return sortedColors.slice(0, 64);
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Analyzes the white regions of the image and generates hints.
 * Optimized with a larger scan step and improved region tracing.
 */
export function generateHints(imageData: ImageData, palette: Color[]): import('../types').Hint[] {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const visited = new Uint8Array(width * height);
  const hints: import('../types').Hint[] = [];
  
  const scanStep = 12; 

  // Use the extracted palette for hints
  const validPalette = palette.filter(c => !['#ffffff', '#000000'].includes(c.hex));
  if (validPalette.length === 0) return [];

  for (let y = 0; y < height; y += scanStep) {
    for (let x = 0; x < width; x += scanStep) {
      const pos = y * width + x;
      
      // If pixel is White (255) and not visited
      if (data[pos * 4] === 255 && visited[pos] === 0) {
        const region = traceRegion(data, width, height, visited, x, y);
        
        if (region.area > 600 && region.area < 80000) { 
           // In a real app, we'd spatially map the original colored image to this region
           // to find the 'correct' color. For now, we pick a random one from the palette
           // to simulate the "Paint by Numbers" experience requested.
           const colorIndex = Math.floor(Math.random() * validPalette.length);
           hints.push({
             x: region.centerX,
             y: region.centerY,
             number: colorIndex + 1, 
             colorHex: validPalette[colorIndex].hex
           });
        }
      }
    }
  }
  return hints;
}

interface RegionInfo {
  area: number;
  centerX: number;
  centerY: number;
}

function traceRegion(data: Uint8ClampedArray, width: number, height: number, visited: Uint8Array, startX: number, startY: number): RegionInfo {
  const stack = [startX, startY];
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  
  visited[startY * width + startX] = 1;

  let iterations = 0;
  const MAX_ITERATIONS = 100000; 

  while (stack.length > 0) {
    iterations++;
    if (iterations > MAX_ITERATIONS) break;

    const y = stack.pop()!;
    const x = stack.pop()!;
    
    area++;
    sumX += x;
    sumY += y;

    // Right
    if (x + 1 < width) {
        const idx = y * width + (x + 1);
        if (visited[idx] === 0 && data[idx * 4] === 255) {
            visited[idx] = 1;
            stack.push(x + 1, y);
        }
    }
    // Left
    if (x - 1 >= 0) {
        const idx = y * width + (x - 1);
        if (visited[idx] === 0 && data[idx * 4] === 255) {
            visited[idx] = 1;
            stack.push(x - 1, y);
        }
    }
    // Down
    if (y + 1 < height) {
        const idx = (y + 1) * width + x;
        if (visited[idx] === 0 && data[idx * 4] === 255) {
            visited[idx] = 1;
            stack.push(x, y + 1);
        }
    }
    // Up
    if (y - 1 >= 0) {
        const idx = (y - 1) * width + x;
        if (visited[idx] === 0 && data[idx * 4] === 255) {
            visited[idx] = 1;
            stack.push(x, y - 1);
        }
    }
  }

  return {
    area,
    centerX: Math.floor(sumX / area),
    centerY: Math.floor(sumY / area)
  };
}
