import { RegionData } from "../types";

/**
 * Detects boundaries between differently-colored regions.
 * Returns a Set of pixel indices where two adjacent regions have different fill colors.
 */
export function computeColorBoundaries(
  regionData: RegionData,
  regionColors: Record<number, string>
): Set<number> {
  const { width, height, labelMap } = regionData;
  const boundaryPixels = new Set<number>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const currentRegion = labelMap[idx];
      
      // Skip wall pixels (region 0)
      if (currentRegion === 0) continue;
      
      const currentColor = regionColors[currentRegion];
      // Skip unfilled regions
      if (!currentColor) continue;

      // Check 4-connected neighbors (right, down, left, up)
      const neighbors = [
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: -1 },
      ];

      for (const { dx, dy } of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        
        const neighborIdx = ny * width + nx;
        const neighborRegion = labelMap[neighborIdx];
        
        // Skip wall pixels
        if (neighborRegion === 0) continue;
        
        const neighborColor = regionColors[neighborRegion];
        
        // Skip unfilled neighbors
        if (!neighborColor) continue;
        
        // If different colors, mark current pixel as boundary
        if (currentColor !== neighborColor) {
          boundaryPixels.add(idx);
          break; // No need to check more neighbors
        }
      }
    }
  }

  return boundaryPixels;
}

/**
 * Renders boundary pixels onto a canvas with specified color and thickness.
 */
export function renderColorBoundaries(params: {
  ctx: CanvasRenderingContext2D;
  boundaryPixels: Set<number>;
  width: number;
  height: number;
  colorHex: string;
  thicknessPx: number;
}) {
  const { ctx, boundaryPixels, width, height, colorHex, thicknessPx } = params;
  
  ctx.clearRect(0, 0, width, height);
  
  if (boundaryPixels.size === 0) return;

  // Convert hex to RGB
  const h = colorHex.replace("#", "").trim();
  let r: number, g: number, b: number;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const radius = Math.max(0, Math.floor((thicknessPx - 1) / 2));

  for (const pixelIdx of boundaryPixels) {
    const x = pixelIdx % width;
    const y = Math.floor(pixelIdx / width);

    // Apply thickness by expanding in a square pattern
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;

      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        
        const j = (ny * width + nx) * 4;
        out[j] = r;
        out[j + 1] = g;
        out[j + 2] = b;
        out[j + 3] = 255;
      }
    }
  }

  const img = new ImageData(out, width, height);
  ctx.putImageData(img, 0, 0);
}
