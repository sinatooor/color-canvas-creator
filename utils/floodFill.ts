
export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: string
): boolean {
  const canvas = ctx.canvas;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  const targetColor = getPixelColor(data, startX, startY, canvas.width);

  // --- IMMUTABLE LINES CHECK ---
  // If the user clicks on a dark pixel (the vector lines), do not fill.
  // We use a strict threshold (approx 6% brightness) to match the binarization logic.
  // This allows painting on dark colors that aren't pure black outlines.
  if (targetColor[0] < 15 && targetColor[1] < 15 && targetColor[2] < 15) {
    return false; // Action blocked: Cannot color the lines
  }

  const replacementColor = hexToRgb(fillColor);

  // Don't fill if color is already the same
  if (colorsMatch(targetColor, replacementColor)) return false;

  // Simple stack-based flood fill
  const stack: [number, number][] = [[startX, startY]];
  const visited = new Uint8Array(canvas.width * canvas.height);

  // Tolerance is low because we have strictly binarized the image already
  const TOLERANCE = 10; 

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    
    // Bounds check already handled by valid push, but double check start
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;
    
    const idx = y * canvas.width + x;
    if (visited[idx]) continue;

    const currentColor = getPixelColor(data, x, y, canvas.width);
    
    // Check if pixel matches target color
    if (colorsMatch(currentColor, targetColor, TOLERANCE)) {
      setPixelColor(data, x, y, canvas.width, replacementColor);
      visited[idx] = 1;

      stack.push([x + 1, y]);
      stack.push([x - 1, y]);
      stack.push([x, y + 1]);
      stack.push([x, y - 1]);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return true; // Action successful
}

function getPixelColor(data: Uint8ClampedArray, x: number, y: number, width: number) {
  const pos = (y * width + x) * 4;
  return [data[pos], data[pos + 1], data[pos + 2], data[pos + 3]];
}

function setPixelColor(data: Uint8ClampedArray, x: number, y: number, width: number, color: number[]) {
  const pos = (y * width + x) * 4;
  data[pos] = color[0];
  data[pos + 1] = color[1];
  data[pos + 2] = color[2];
  data[pos + 3] = 255;
}

function colorsMatch(c1: number[], c2: number[], threshold: number = 0) {
  return (
    Math.abs(c1[0] - c2[0]) <= threshold &&
    Math.abs(c1[1] - c2[1]) <= threshold &&
    Math.abs(c1[2] - c2[2]) <= threshold
  );
}

function hexToRgb(hex: string): number[] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}
