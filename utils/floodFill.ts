
export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: string,
  segmentationData?: ImageData | null
): boolean {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // 1. Get the current visible state (destination)
  // We need this to ensure we don't paint over the black lines that the user sees.
  const destinationImageData = ctx.getImageData(0, 0, width, height);
  const destData = destinationImageData.data;

  // 2. Determine which data source to use for boundary detection (traversal)
  // If segmentationData (Answer Key) is provided, we traverse that.
  // Otherwise, we traverse the visible canvas itself (classic flood fill).
  const traverseData = segmentationData ? segmentationData.data : destData;

  // 3. Get the Target Color at the starting point from the Traversal Data
  const startIdx = (startY * width + startX) * 4;
  const targetR = traverseData[startIdx];
  const targetG = traverseData[startIdx + 1];
  const targetB = traverseData[startIdx + 2];
  const targetA = traverseData[startIdx + 3];

  // Safety: If clicking on a transparent area or out of bounds (though coords are checked before)
  if (targetA === 0) return false;

  // 4. Check if we are clicking on a Line (Black/Dark)
  // If we rely on segmentation data, the lines are black there too.
  // Threshold: < 50 is safe for "Dark Line" in a coloring app context.
  if (targetR < 50 && targetG < 50 && targetB < 50) {
    return false; // Action blocked: Cannot color the lines
  }

  // 5. Prepare for Traversal
  const replacementColor = hexToRgb(fillColor);
  
  // Optimization: If the visible pixel is already the replacement color, stop.
  // (Only if not using segmentation, or if using segmentation check if we already filled this visual spot)
  if (!segmentationData) {
      const destR = destData[startIdx];
      const destG = destData[startIdx + 1];
      const destB = destData[startIdx + 2];
      if (Math.abs(destR - replacementColor[0]) < 5 && 
          Math.abs(destG - replacementColor[1]) < 5 && 
          Math.abs(destB - replacementColor[2]) < 5) {
          return false;
      }
  }

  // Stack-based Flood Fill
  const stack: [number, number][] = [[startX, startY]];
  const visited = new Uint8Array(width * height); // Keep track of visited pixels to prevent loops
  
  // Higher tolerance for segmentation matching because the reference image might have compression artifacts
  const TOLERANCE = segmentationData ? 40 : 15; 

  let pixelsFilled = 0;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    
    // Bounds check
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    
    const idx = y * width + x;
    const pixelIndex = idx * 4;

    if (visited[idx]) continue;
    visited[idx] = 1;

    // Check boundary condition on the Traversal Data
    const r = traverseData[pixelIndex];
    const g = traverseData[pixelIndex + 1];
    const b = traverseData[pixelIndex + 2];

    if (colorsMatch([r, g, b], [targetR, targetG, targetB], TOLERANCE)) {
      // It matches the region!
      
      // Now Paint on the Destination (Visible Canvas)
      // CRITICAL: Do not overwrite dark lines on the visible canvas.
      const destR = destData[pixelIndex];
      const destG = destData[pixelIndex + 1];
      const destB = destData[pixelIndex + 2];
      
      // If the visible pixel is NOT a dark line, paint it.
      // Use a strict threshold for lines on the visible canvas (vector lines are usually sharp black)
      const isLine = destR < 50 && destG < 50 && destB < 50;
      
      if (!isLine) {
          destData[pixelIndex] = replacementColor[0];
          destData[pixelIndex + 1] = replacementColor[1];
          destData[pixelIndex + 2] = replacementColor[2];
          destData[pixelIndex + 3] = 255; // Ensure full opacity
          pixelsFilled++;
      }

      // Add neighbors
      // Optimization: Only add neighbors if they haven't been visited?
      // The visited check is at the top of the loop.
      if (x + 1 < width && !visited[idx + 1]) stack.push([x + 1, y]);
      if (x - 1 >= 0 && !visited[idx - 1]) stack.push([x - 1, y]);
      if (y + 1 < height && !visited[idx + width]) stack.push([x, y + 1]);
      if (y - 1 >= 0 && !visited[idx - width]) stack.push([x, y - 1]);
    }
  }

  if (pixelsFilled > 0) {
      ctx.putImageData(destinationImageData, 0, 0);
      return true;
  }
  
  return false;
}

function colorsMatch(c1: number[], c2: number[], threshold: number) {
  return (
    Math.abs(c1[0] - c2[0]) <= threshold &&
    Math.abs(c1[1] - c2[1]) <= threshold &&
    Math.abs(c1[2] - c2[2]) <= threshold
  );
}

export function hexToRgb(hex: string): number[] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}
