
import { Color, Hint } from '../types';

/**
 * Converts image data to strict Black and White (1-bit equivalent).
 * Uses Max Channel Value < 20 to identify lines.
 */
export function binarizeImageData(imageData: ImageData, threshold: number = 20): ImageData {
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

    // Check if the pixel at the hint location is still white
    if (r > 240 && g > 240 && b > 240) {
      uncoloredCount++;
    }
  }

  return uncoloredCount === 0;
}

export function extractPalette(imageData: ImageData): Color[] {
  const data = imageData.data;
  const colorCounts = new Map<string, number>();

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r < 50 && g < 50 && b < 50) continue;
    if (r > 240 && g > 240 && b > 240) continue;

    const qr = Math.round(r / 10) * 10;
    const qg = Math.round(g / 10) * 10;
    const qb = Math.round(b / 10) * 10;

    const hex = rgbToHex(qr, qg, qb);
    colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
  }

  const sortedColors = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => ({ name: hex, hex }));

  if (sortedColors.length === 0) return [{ name: 'Blue', hex: '#3b82f6' }];
  return sortedColors.slice(0, 64);
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function generateHints(imageData: ImageData, palette: Color[]): import('../types').Hint[] {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const visited = new Uint8Array(width * height);
  const hints: import('../types').Hint[] = [];
  
  const scanStep = 12; 

  const validPalette = palette.filter(c => !['#ffffff', '#000000'].includes(c.hex));
  if (validPalette.length === 0) return [];

  for (let y = 0; y < height; y += scanStep) {
    for (let x = 0; x < width; x += scanStep) {
      const pos = y * width + x;
      
      if (data[pos * 4] === 255 && visited[pos] === 0) {
        const region = traceRegion(data, width, height, visited, x, y);
        
        if (region.area > 600 && region.area < 80000) { 
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

    if (x + 1 < width) {
        const idx = y * width + (x + 1);
        if (visited[idx] === 0 && data[idx * 4] === 255) {
            visited[idx] = 1;
            stack.push(x + 1, y);
        }
    }
    if (x - 1 >= 0) {
        const idx = y * width + (x - 1);
        if (visited[idx] === 0 && data[idx * 4] === 255) {
            visited[idx] = 1;
            stack.push(x - 1, y);
        }
    }
    if (y + 1 < height) {
        const idx = (y + 1) * width + x;
        if (visited[idx] === 0 && data[idx * 4] === 255) {
            visited[idx] = 1;
            stack.push(x, y + 1);
        }
    }
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
