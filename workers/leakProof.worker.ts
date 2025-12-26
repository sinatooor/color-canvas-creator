/**
 * Leak-Proof Coloring Worker
 * 
 * Performs advanced preprocessing to seal gaps in outlines:
 * 1. Morphological operations (close/open)
 * 2. Endpoint bridging (connect nearby line endpoints)
 * 3. Color edge detection (add walls at color boundaries)
 * 4. Leak validation and repair
 * 5. Connected components labeling
 */

export interface WorkerParams {
  outlineBlackRgbDistance: number;
  maxGapPx: number;
  thickenPx: number;
  closeKernelPx: number;
  openKernelPx: number;
  endpointBridge: {
    enabled: boolean;
    maxEndpointDistancePx: number;
    maxBridgesPerMegapixel: number;
    angleLimitDegrees: number;
  };
  colorEdgeWalls: {
    enabled: boolean;
    minColorDeltaL2: number;
    dilatePx: number;
  };
  leakValidation: {
    enabled: boolean;
    smallIslandTolerancePx: number;
    strengthenOnce: boolean;
  };
}

interface ProcessMessage {
  type: "PROCESS";
  payload: {
    rgba: ArrayBuffer;
    width: number;
    height: number;
    params: WorkerParams;
  };
}

type WorkerMessage = ProcessMessage;

function postProgress(stage: string, pct: number) {
  self.postMessage({ type: "PROGRESS", payload: { stage, pct } });
}

function postError(msg: string) {
  self.postMessage({ type: "ERROR", payload: msg });
}

function postDone(
  width: number,
  height: number,
  regionCount: number,
  labels: Uint16Array,
  wall: Uint8Array
) {
  // Create new typed arrays with explicit ArrayBuffer type for transfer
  const labelsBuffer = new Uint16Array(labels).buffer;
  const wallBuffer = new Uint8Array(wall).buffer;
  
  self.postMessage(
    {
      type: "DONE",
      payload: { width, height, regionCount, labels: new Uint16Array(labelsBuffer), wall: new Uint8Array(wallBuffer) },
    },
    { transfer: [labelsBuffer, wallBuffer] }
  );
}

// ========== Utility Functions ==========

function rgbDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function createBinaryMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    // Check if pixel is dark (outline)
    const dist = rgbDistance(r, g, b, 0, 0, 0);
    mask[i] = dist < threshold ? 1 : 0;
  }
  return mask;
}

// ========== Morphological Operations ==========

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const output = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        for (let dx = -radius; dx <= radius && !found; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (mask[ny * width + nx] > 0) {
              found = true;
            }
          }
        }
      }
      output[y * width + x] = found ? 1 : 0;
    }
  }
  return output;
}

function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const output = new Uint8Array(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allSet = true;
      for (let dy = -radius; dy <= radius && allSet; dy++) {
        for (let dx = -radius; dx <= radius && allSet; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (mask[ny * width + nx] === 0) {
              allSet = false;
            }
          } else {
            allSet = false;
          }
        }
      }
      output[y * width + x] = allSet ? 1 : 0;
    }
  }
  return output;
}

function morphClose(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dilated = dilate(mask, width, height, radius);
  return erode(dilated, width, height, radius);
}

function morphOpen(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const eroded = erode(mask, width, height, radius);
  return dilate(eroded, width, height, radius);
}

// ========== Endpoint Detection & Bridging ==========

interface Endpoint {
  x: number;
  y: number;
  dx: number; // Direction vector
  dy: number;
}

function findEndpoints(mask: Uint8Array, width: number, height: number): Endpoint[] {
  const endpoints: Endpoint[] = [];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (mask[y * width + x] === 0) continue;
      
      // Count 8-connected neighbors
      let neighborCount = 0;
      let sumDx = 0;
      let sumDy = 0;
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (mask[(y + dy) * width + (x + dx)] > 0) {
            neighborCount++;
            sumDx -= dx;
            sumDy -= dy;
          }
        }
      }
      
      // Endpoint has exactly 1 neighbor
      if (neighborCount === 1) {
        const len = Math.sqrt(sumDx * sumDx + sumDy * sumDy);
        endpoints.push({
          x,
          y,
          dx: len > 0 ? sumDx / len : 0,
          dy: len > 0 ? sumDy / len : 0,
        });
      }
    }
  }
  
  return endpoints;
}

function bridgeEndpoints(
  mask: Uint8Array,
  width: number,
  height: number,
  params: WorkerParams["endpointBridge"]
): Uint8Array {
  if (!params.enabled) return mask;
  
  const endpoints = findEndpoints(mask, width, height);
  const output = mask.slice();
  const maxBridges = Math.ceil((width * height) / 1000000 * params.maxBridgesPerMegapixel);
  const cosLimit = Math.cos((params.angleLimitDegrees * Math.PI) / 180);
  
  let bridgeCount = 0;
  const used = new Set<number>();
  
  for (let i = 0; i < endpoints.length && bridgeCount < maxBridges; i++) {
    if (used.has(i)) continue;
    const ep1 = endpoints[i];
    
    let bestJ = -1;
    let bestDist = Infinity;
    
    for (let j = i + 1; j < endpoints.length; j++) {
      if (used.has(j)) continue;
      const ep2 = endpoints[j];
      
      const dx = ep2.x - ep1.x;
      const dy = ep2.y - ep1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > params.maxEndpointDistancePx || dist < 2) continue;
      
      // Check angle compatibility
      const ndx = dx / dist;
      const ndy = dy / dist;
      
      // ep1's direction should point toward ep2
      const dot1 = ep1.dx * ndx + ep1.dy * ndy;
      // ep2's direction should point toward ep1
      const dot2 = -(ep2.dx * ndx + ep2.dy * ndy);
      
      if (dot1 < cosLimit || dot2 < cosLimit) continue;
      
      if (dist < bestDist) {
        bestDist = dist;
        bestJ = j;
      }
    }
    
    if (bestJ >= 0) {
      const ep2 = endpoints[bestJ];
      // Draw line between endpoints
      drawLine(output, width, height, ep1.x, ep1.y, ep2.x, ep2.y);
      used.add(i);
      used.add(bestJ);
      bridgeCount++;
    }
  }
  
  return output;
}

function drawLine(
  mask: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  
  let x = x0;
  let y = y0;
  
  while (true) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      mask[y * width + x] = 1;
    }
    
    if (x === x1 && y === y1) break;
    
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

// ========== Color Edge Detection ==========

function addColorEdgeWalls(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  params: WorkerParams["colorEdgeWalls"]
): Uint8Array {
  if (!params.enabled) return mask;
  
  const output = mask.slice();
  const threshold = params.minColorDeltaL2;
  
  // Detect horizontal edges
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i1 = (y * width + x) * 4;
      const i2 = (y * width + x + 1) * 4;
      
      const dr = rgba[i1] - rgba[i2];
      const dg = rgba[i1 + 1] - rgba[i2 + 1];
      const db = rgba[i1 + 2] - rgba[i2 + 2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      
      if (dist > threshold) {
        output[y * width + x] = 1;
        output[y * width + x + 1] = 1;
      }
    }
  }
  
  // Detect vertical edges
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const i1 = (y * width + x) * 4;
      const i2 = ((y + 1) * width + x) * 4;
      
      const dr = rgba[i1] - rgba[i2];
      const dg = rgba[i1 + 1] - rgba[i2 + 1];
      const db = rgba[i1 + 2] - rgba[i2 + 2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      
      if (dist > threshold) {
        output[y * width + x] = 1;
        output[(y + 1) * width + x] = 1;
      }
    }
  }
  
  // Dilate edges slightly
  if (params.dilatePx > 0) {
    return dilate(output, width, height, params.dilatePx);
  }
  
  return output;
}

// ========== Connected Components Labeling ==========

function labelRegions(
  wall: Uint8Array,
  width: number,
  height: number
): { labels: Uint16Array; regionCount: number } {
  const labels = new Uint16Array(width * height);
  let currentLabel = 0;
  const stack: number[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (wall[idx] > 0 || labels[idx] > 0) continue;
      
      currentLabel++;
      labels[idx] = currentLabel;
      stack.push(idx);
      
      while (stack.length > 0) {
        const currIdx = stack.pop()!;
        const cx = currIdx % width;
        const cy = Math.floor(currIdx / width);
        
        // 4-connectivity
        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (wall[nIdx] === 0 && labels[nIdx] === 0) {
            labels[nIdx] = currentLabel;
            stack.push(nIdx);
          }
        }
      }
    }
  }
  
  return { labels, regionCount: currentLabel + 1 }; // +1 to include region 0 (walls)
}

// ========== Leak Validation ==========

function validateAndRepair(
  wall: Uint8Array,
  labels: Uint16Array,
  width: number,
  height: number,
  params: WorkerParams["leakValidation"]
): { wall: Uint8Array; labels: Uint16Array; regionCount: number } {
  if (!params.enabled) {
    return { wall, labels, regionCount: Math.max(...labels) + 1 };
  }
  
  // Count region sizes
  const regionSizes = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    regionSizes.set(label, (regionSizes.get(label) || 0) + 1);
  }
  
  // Find tiny regions (potential leaks)
  const tinyRegions = new Set<number>();
  for (const [label, size] of regionSizes) {
    if (label > 0 && size < params.smallIslandTolerancePx) {
      tinyRegions.add(label);
    }
  }
  
  // Merge tiny regions into walls
  const newWall = wall.slice();
  for (let i = 0; i < labels.length; i++) {
    if (tinyRegions.has(labels[i])) {
      newWall[i] = 1;
    }
  }
  
  // If strengthenOnce, do another close operation
  let finalWall: Uint8Array<ArrayBuffer> = newWall as Uint8Array<ArrayBuffer>;
  if (params.strengthenOnce) {
    finalWall = morphClose(newWall, width, height, 2) as Uint8Array<ArrayBuffer>;
  }
  
  // Re-label with cleaned walls
  const result = labelRegions(finalWall, width, height);
  
  return { wall: finalWall as Uint8Array<ArrayBuffer>, ...result };
}

// ========== Main Processing Pipeline ==========

function process(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  params: WorkerParams
) {
  postProgress("Detecting outlines", 10);
  
  // Step 1: Create initial binary mask from dark pixels
  let mask = createBinaryMask(rgba, width, height, params.outlineBlackRgbDistance);
  
  postProgress("Thickening lines", 20);
  
  // Step 2: Thicken lines
  if (params.thickenPx > 0) {
    mask = dilate(mask, width, height, params.thickenPx);
  }
  
  postProgress("Closing gaps", 30);
  
  // Step 3: Morphological close (fill gaps)
  if (params.closeKernelPx > 0) {
    mask = morphClose(mask, width, height, Math.floor(params.closeKernelPx / 2));
  }
  
  postProgress("Bridging endpoints", 45);
  
  // Step 4: Bridge line endpoints
  mask = bridgeEndpoints(mask, width, height, params.endpointBridge);
  
  postProgress("Detecting color edges", 55);
  
  // Step 5: Add walls at color boundaries
  mask = addColorEdgeWalls(rgba, mask, width, height, params.colorEdgeWalls);
  
  postProgress("Opening (noise removal)", 65);
  
  // Step 6: Morphological open (remove small noise)
  if (params.openKernelPx > 0) {
    mask = morphOpen(mask, width, height, Math.floor(params.openKernelPx / 2));
  }
  
  postProgress("Labeling regions", 75);
  
  // Step 7: Label connected regions
  let { labels, regionCount } = labelRegions(mask, width, height);
  
  postProgress("Validating leaks", 90);
  
  // Step 8: Validate and repair
  const validated = validateAndRepair(mask, labels, width, height, params.leakValidation);
  
  postProgress("Complete", 100);
  
  postDone(width, height, validated.regionCount, new Uint16Array(validated.labels), new Uint8Array(validated.wall));
}

// ========== Message Handler ==========

self.onmessage = (ev: MessageEvent<WorkerMessage>) => {
  const { type, payload } = ev.data;
  
  if (type === "PROCESS") {
    try {
      const rgba = new Uint8ClampedArray(payload.rgba);
      process(rgba, payload.width, payload.height, payload.params);
    } catch (err) {
      postError(err instanceof Error ? err.message : "Unknown error");
    }
  }
};

export {};
