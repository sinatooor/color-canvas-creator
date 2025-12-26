
import { RegionData, ScanlineRun, Color } from "../types";
import { hexToRgb } from "./floodFill";
import { WALL_THRESHOLD } from "../constants";

/**
 * ARCHITECTURE IMPLEMENTATION: Label Map Generator
 * 
 * Performs Connected Components Labeling (CCL) on the image.
 * - Treats black/dark pixels as Walls (ID: 0)
 * - Groups connected non-dark pixels into Regions (ID: 1..N)
 * 
 * PERFORMANCE: Uses Int32Array internally, converts to number[] for JSON serialization.
 * Future optimization: Use Uint32Array + Base64 encoding for ~4x size reduction.
 */
export function computeLabelMap(imageData: ImageData): RegionData {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const labels = new Int32Array(width * height).fill(-1); // -1: Unvisited
    let currentLabel = 1;

    // Helper: Check if a pixel is a boundary (Wall)
    // Uses WALL_THRESHOLD constant for dark pixel detection
    const isWall = (idx: number) => {
        const r = data[idx * 4];
        const g = data[idx * 4 + 1];
        const b = data[idx * 4 + 2];
        return r < WALL_THRESHOLD && g < WALL_THRESHOLD && b < WALL_THRESHOLD;
    };

    // Pre-allocate stack with estimated capacity for performance
    const stack: number[] = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;

            // If already labeled, skip
            if (labels[idx] !== -1) continue;

            if (isWall(idx)) {
                labels[idx] = 0; // 0 is reserved for boundaries/walls
                continue;
            }

            // Start a new region
            labels[idx] = currentLabel;
            stack.push(idx);

            while (stack.length > 0) {
                const currIdx = stack.pop()!;
                const cx = currIdx % width;
                const cy = Math.floor(currIdx / width);

                // Check 4-connectivity neighbors (inline for performance)
                // Right
                if (cx + 1 < width) {
                    const nIdx = currIdx + 1;
                    if (labels[nIdx] === -1) {
                        if (isWall(nIdx)) {
                            labels[nIdx] = 0;
                        } else {
                            labels[nIdx] = currentLabel;
                            stack.push(nIdx);
                        }
                    }
                }
                // Left
                if (cx > 0) {
                    const nIdx = currIdx - 1;
                    if (labels[nIdx] === -1) {
                        if (isWall(nIdx)) {
                            labels[nIdx] = 0;
                        } else {
                            labels[nIdx] = currentLabel;
                            stack.push(nIdx);
                        }
                    }
                }
                // Down
                if (cy + 1 < height) {
                    const nIdx = currIdx + width;
                    if (labels[nIdx] === -1) {
                        if (isWall(nIdx)) {
                            labels[nIdx] = 0;
                        } else {
                            labels[nIdx] = currentLabel;
                            stack.push(nIdx);
                        }
                    }
                }
                // Up
                if (cy > 0) {
                    const nIdx = currIdx - width;
                    if (labels[nIdx] === -1) {
                        if (isWall(nIdx)) {
                            labels[nIdx] = 0;
                        } else {
                            labels[nIdx] = currentLabel;
                            stack.push(nIdx);
                        }
                    }
                }
            }

            currentLabel++;
        }
    }

    return {
        width,
        height,
        labelMap: Array.from(labels), // Convert TypedArray to standard array for JSON serialization
        maxRegionId: currentLabel - 1
    };
}

/**
 * Precomputes scanline runs for efficient rendering.
 * Returns a Map where Key = RegionID, Value = Array of [y, xStart, xEnd]
 */
export function computeScanlineRuns(regionData: RegionData): Map<number, ScanlineRun[]> {
    const { width, height, labelMap } = regionData;
    const runs = new Map<number, ScanlineRun[]>();

    for (let y = 0; y < height; y++) {
        let x = 0;
        while (x < width) {
            const id = labelMap[y * width + x];
            
            // Skip walls (ID 0)
            if (id === 0) {
                x++;
                continue;
            }

            const startX = x;
            // Find end of this run
            while (x < width && labelMap[y * width + x] === id) {
                x++;
            }
            const endX = x - 1;

            if (!runs.has(id)) {
                runs.set(id, []);
            }
            runs.get(id)!.push([y, startX, endX]);
        }
    }

    return runs;
}

export interface RegionHint {
    regionId: number;
    x: number;
    y: number;
    paletteIndex: number;
    colorHex: string;
}

/**
 * Analyzes the regions against the ORIGINAL colored image to find:
 * 1. The geometric centroid of each region (for placing the number).
 * 2. The average color of that region.
 * 3. The closest matching color in our palette.
 */
export function analyzeRegionHints(
    regionData: RegionData, 
    originalImageData: ImageData, 
    palette: Color[]
): RegionHint[] {
    const { width, labelMap, maxRegionId } = regionData;
    
    // Accumulators
    const sums = new Float64Array((maxRegionId + 1) * 5); // [xSum, ySum, count, rSum, gSum, bSum]... actually just pixel accumulation
    // Structure: index = regionId * 3. 0=xSum, 1=ySum, 2=count. 
    // We need color sampling too. Let's do a slightly heavier obj approach for clarity or parallel arrays.
    // Parallel arrays for performance.
    const xSum = new Float64Array(maxRegionId + 1);
    const ySum = new Float64Array(maxRegionId + 1);
    const count = new Int32Array(maxRegionId + 1);
    const rSum = new Float64Array(maxRegionId + 1);
    const gSum = new Float64Array(maxRegionId + 1);
    const bSum = new Float64Array(maxRegionId + 1);

    const data = originalImageData.data;

    // Single pass to accumulate spatial and color data
    for (let i = 0; i < labelMap.length; i++) {
        const id = labelMap[i];
        if (id === 0) continue;

        const x = i % width;
        const y = Math.floor(i / width);

        xSum[id] += x;
        ySum[id] += y;
        count[id]++;

        // Sample Original Color
        const pxIdx = i * 4;
        rSum[id] += data[pxIdx];
        gSum[id] += data[pxIdx + 1];
        bSum[id] += data[pxIdx + 2];
    }

    const hints: RegionHint[] = [];

    // Process accumulators into Hints
    // Import MIN_REGION_SIZE_FOR_HINTS at top - using inline value for now
    const MIN_HINT_SIZE = 100; // Minimum region size to show hints (filter noise)
    
    for (let id = 1; id <= maxRegionId; id++) {
        if (count[id] < MIN_HINT_SIZE) continue; // Skip tiny specks to avoid clutter

        const avgR = rSum[id] / count[id];
        const avgG = gSum[id] / count[id];
        const avgB = bSum[id] / count[id];

        // Find closest palette color
        let minDiff = Infinity;
        let bestIndex = 0;

        for (let p = 0; p < palette.length; p++) {
            const pRgb = hexToRgb(palette[p].hex);
            const diff = Math.abs(avgR - pRgb[0]) + Math.abs(avgG - pRgb[1]) + Math.abs(avgB - pRgb[2]);
            if (diff < minDiff) {
                minDiff = diff;
                bestIndex = p;
            }
        }

        hints.push({
            regionId: id,
            x: Math.round(xSum[id] / count[id]),
            y: Math.round(ySum[id] / count[id]),
            paletteIndex: bestIndex,
            colorHex: palette[bestIndex].hex
        });
    }

    return hints;
}
