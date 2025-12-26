import React, { useRef, useEffect, useState, useCallback, useLayoutEffect } from "react";
import { Color, TimelapseFrame, RegionData, ScanlineRun } from "../types";
import { MAX_UNDO_STEPS } from "../constants";
import { soundEngine } from "../utils/soundEffects";
import { computeScanlineRuns, analyzeRegionHints, RegionHint } from "../utils/labeling";

interface DrawingCanvasProps {
  regionData: RegionData;
  outlinesUrl: string;
  initialStateUrl?: string;
  initialRegionColors?: Record<number, string>;
  coloredIllustrationUrl: string | null;
  selectedColor: string;
  outlineColor?: string;
  isEraser: boolean;
  onHintClick: (colorHex: string) => void;
  onProcessingHints: (isProcessing: boolean) => void;
  onAutoSave?: (imageDataUrl: string, regionColors: Record<number, string>, timelapse?: TimelapseFrame[]) => void;
  onCompletion?: (imageDataUrl: string, timelapse: TimelapseFrame[]) => void;
  palette: Color[];
  existingTimelapse?: TimelapseFrame[];
  width: number;
  height: number;
}

// Renders outlines directly from RegionData.labelMap (no SVG/image overlay).
// Any pixel with regionId=0 is treated as an outline "wall".
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const renderOutlinesFromLabelMap = (params: {
  ctx: CanvasRenderingContext2D;
  regionData: RegionData;
  width: number;
  height: number;
  colorHex: string;
  thicknessPx: number;
}) => {
  const { ctx, regionData, width, height, colorHex, thicknessPx } = params;
  const [r, g, b] = hexToRgb(colorHex);

  ctx.clearRect(0, 0, width, height);

  const out = new Uint8ClampedArray(width * height * 4);
  const lm = regionData.labelMap;
  const radius = Math.max(0, Math.min(3, Math.floor((thicknessPx - 1) / 2)));

  for (let i = 0; i < lm.length; i++) {
    if (lm[i] !== 0) continue;

    const x = i % width;
    const y = (i / width) | 0;

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
};

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  regionData,
  outlinesUrl: _outlinesUrl,
  coloredIllustrationUrl,
  initialRegionColors = {},
  selectedColor,
  outlineColor = "#000000",
  isEraser,
  onProcessingHints,
  onAutoSave,
  onCompletion,
  palette,
  existingTimelapse,
  width,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Layers
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const hintsCanvasRef = useRef<HTMLCanvasElement>(null);
  const outlinesCanvasRef = useRef<HTMLCanvasElement>(null);

  // Outline rendering (derived from label map)
  const [outlinesEnabled, setOutlinesEnabled] = useState(true);
  const [outlineThicknessPx, setOutlineThicknessPx] = useState(3);
  const [outlinesReady, setOutlinesReady] = useState(false);

  // Engine State
  const runsRef = useRef<Map<number, ScanlineRun[]> | null>(null);
  const hintsRef = useRef<RegionHint[]>([]);
  const [isEngineReady, setIsEngineReady] = useState(false);

  // App State
  const [regionColors, setRegionColors] = useState<Record<number, string>>(initialRegionColors);
  const [history, setHistory] = useState<Record<number, string>[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [ripples, setRipples] = useState<{ x: number; y: number; id: number; color: string }[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const timelapseLog = useRef<TimelapseFrame[]>([]);

  // Transform & Interaction State
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<"paint" | "move">("paint");

  // Input Handling Refs
  const evCache = useRef<React.PointerEvent[]>([]);
  const prevDiff = useRef<number>(-1);

  const isPaintingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const lastPaintedRegionId = useRef<number>(-1);
  const strokeChangesRef = useRef<Record<number, string>>({});

  // 0) Render outlines directly from the label map (no external assets)
  useEffect(() => {
    if (!outlinesCanvasRef.current) return;
    if (!regionData || regionData.labelMap.length === 0) return;

    const ctx = outlinesCanvasRef.current.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    if (!outlinesEnabled) {
      ctx.clearRect(0, 0, width, height);
      setOutlinesReady(false);
      return;
    }

    renderOutlinesFromLabelMap({
      ctx,
      regionData,
      width,
      height,
      colorHex: outlineColor,
      thicknessPx: outlineThicknessPx,
    });

    setOutlinesReady(true);
  }, [regionData, width, height, outlineColor, outlinesEnabled, outlineThicknessPx]);

  // 1. Initial Fit
  useEffect(() => {
    if (containerRef.current && width > 0 && height > 0) {
      const { width: cW, height: cH } = containerRef.current.getBoundingClientRect();
      const availW = cW - 40;
      const availH = cH - 40;
      const scaleX = availW / width;
      const scaleY = availH / height;
      const fitScale = Math.min(scaleX, scaleY);
      const x = (cW - width * fitScale) / 2;
      const y = (cH - height * fitScale) / 2;
      setTransform({ scale: fitScale, x, y });
    }
  }, [width, height]);

  // 2. Initialize Engine
  useEffect(() => {
    if (!regionData || regionData.labelMap.length === 0) return;

    const initEngine = async () => {
      onProcessingHints(true);
      const runs = computeScanlineRuns(regionData);
      runsRef.current = runs;

      if (coloredIllustrationUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = coloredIllustrationUrl;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          tempCtx.drawImage(img, 0, 0);
          const originalData = tempCtx.getImageData(0, 0, width, height);
          hintsRef.current = analyzeRegionHints(regionData, originalData, palette);
        }
      }

      setIsEngineReady(true);
      onProcessingHints(false);
    };

    setTimeout(initEngine, 50);
  }, [regionData, coloredIllustrationUrl, palette, width, height, onProcessingHints]);

  // 3. Canvas Init & Restore
  useEffect(() => {
    if (!isEngineReady || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    contextRef.current = ctx;

    ctx.clearRect(0, 0, width, height);
    Object.entries(regionColors).forEach(([idStr, color]) => {
      paintRegion(ctx, parseInt(idStr, 10), color);
    });

    if (history.length === 0) {
      setHistory([initialRegionColors]);
      setHistoryIndex(0);
    }

    if (existingTimelapse && existingTimelapse.length > 0) {
      timelapseLog.current = [...existingTimelapse];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEngineReady, width, height]);

  // 4. Smart Hints Layer ("Zen Mode")
  useLayoutEffect(() => {
    const cvs = hintsCanvasRef.current;
    if (!cvs || !isEngineReady) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Only show hints if zoomed in slightly (performance)
    if (transform.scale < 0.5) return;

    const hints = hintsRef.current;
    ctx.font = 'bold 16px "Outfit", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    hints.forEach((hint) => {
      if (regionColors[hint.regionId]) return;

      const isMatchingColor = palette[hint.paletteIndex]?.hex === selectedColor;
      if (isMatchingColor) {
        ctx.beginPath();
        ctx.arc(hint.x, hint.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = selectedColor;
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.fillText((hint.paletteIndex + 1).toString(), hint.x, hint.y);
      }
    });
  }, [transform.scale, regionColors, selectedColor, isEngineReady, width, height, palette]);

  const paintRegion = useCallback((ctx: CanvasRenderingContext2D, regionId: number, color: string) => {
    if (!runsRef.current) return;
    const runs = runsRef.current.get(regionId);
    if (!runs) return;

    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [y, xStart, xEnd] of runs) {
      ctx.rect(xStart, y, xEnd - xStart + 1, 1);
    }
    ctx.fill();
  }, []);

  const saveHistoryStep = useCallback(
    (mergedColors: Record<number, string>) => {
      const newHistory = history.slice(0, historyIndex + 1);
      if (newHistory.length >= MAX_UNDO_STEPS) newHistory.shift();
      newHistory.push(mergedColors);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [history, historyIndex],
  );

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const prevColors = history[newIndex];
      setRegionColors(prevColors);
      setHistoryIndex(newIndex);
      timelapseLog.current.pop();

      const ctx = contextRef.current;
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        Object.entries(prevColors).forEach(([idStr, color]) => {
          paintRegion(ctx, parseInt(idStr, 10), color);
        });
      }
    }
  }, [historyIndex, history, width, height, paintRegion]);

  const generateCompositeImage = useCallback(async () => {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return "";

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Paint layer (with multiply blend)
    if (canvasRef.current) {
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(canvasRef.current, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }

    // Outline layer
    if (outlinesCanvasRef.current && outlinesReady) {
      ctx.drawImage(outlinesCanvasRef.current, 0, 0);
    }

    return tempCanvas.toDataURL("image/png");
  }, [width, height, outlinesReady]);

  // Auto-Save
  useEffect(() => {
    if (!onAutoSave) return;
    const interval = setInterval(async () => {
      if (Object.keys(regionColors).length > 0 && !isCompleted) {
        const url = await generateCompositeImage();
        onAutoSave(url, regionColors, timelapseLog.current);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [onAutoSave, regionColors, isCompleted, generateCompositeImage]);

  const getRegionIdAtEvent = (e: React.PointerEvent) => {
    if (!containerRef.current) return -1;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const imageX = Math.floor((mouseX - transform.x) / transform.scale);
    const imageY = Math.floor((mouseY - transform.y) / transform.scale);

    if (imageX < 0 || imageX >= width || imageY < 0 || imageY >= height) return -1;
    return regionData.labelMap[imageY * width + imageX];
  };

  const applyPaintToRegion = (regionId: number, clientX: number, clientY: number) => {
    if (regionId <= 0) return;

    const ctx = contextRef.current;
    if (!ctx) return;

    if (isEraser) {
      ctx.globalCompositeOperation = "destination-out";
      paintRegion(ctx, regionId, "black");
      ctx.globalCompositeOperation = "source-over";
    } else {
      paintRegion(ctx, regionId, selectedColor);
    }

    soundEngine.playPop();
    addRipple(clientX, clientY, isEraser ? "gray" : selectedColor);

    setRegionColors((prev) => {
      const next = { ...prev };
      if (isEraser) delete next[regionId];
      else next[regionId] = selectedColor;
      strokeChangesRef.current = next;
      return next;
    });

    timelapseLog.current.push({ x: 0, y: 0, regionId, color: isEraser ? "TRANSPARENT" : selectedColor });
  };

  const checkCompletion = () => {
    const coloredCount = Object.keys(regionColors).length;
    if (regionData.maxRegionId > 10 && coloredCount > regionData.maxRegionId * 0.95 && !isCompleted) {
      setIsCompleted(true);
      soundEngine.playCheer();
      if (onCompletion) {
        generateCompositeImage().then((url) => onCompletion(url, timelapseLog.current));
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    containerRef.current?.setPointerCapture(e.pointerId);
    evCache.current.push(e);

    const isMultiTouch = evCache.current.length > 1;
    const isMoveMode = mode === "move" || e.button === 1;

    if (isMoveMode || isMultiTouch) {
      isPanningRef.current = true;
      isPaintingRef.current = false;
      lastPoint.current = { x: e.clientX, y: e.clientY };
    } else {
      isPaintingRef.current = true;
      isPanningRef.current = false;
      strokeChangesRef.current = { ...regionColors };

      const rid = getRegionIdAtEvent(e);
      if (rid > 0) {
        lastPaintedRegionId.current = rid;
        applyPaintToRegion(rid, e.clientX, e.clientY);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const index = evCache.current.findIndex((ev) => ev.pointerId === e.pointerId);
    if (index > -1) evCache.current[index] = e;

    if (isPanningRef.current) {
      if (evCache.current.length === 2) {
        const curDiff = Math.hypot(
          evCache.current[0].clientX - evCache.current[1].clientX,
          evCache.current[0].clientY - evCache.current[1].clientY,
        );
        if (prevDiff.current > 0) {
          const delta = curDiff - prevDiff.current;
          setTransform((t) => ({
            ...t,
            scale: Math.min(Math.max(0.1, t.scale + delta * 0.005), 8),
          }));
        }
        prevDiff.current = curDiff;
      } else if (lastPoint.current) {
        const dx = e.clientX - lastPoint.current.x;
        const dy = e.clientY - lastPoint.current.y;
        setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
        lastPoint.current = { x: e.clientX, y: e.clientY };
      }
      return;
    }

    if (isPaintingRef.current) {
      const rid = getRegionIdAtEvent(e);
      if (rid > 0 && rid !== lastPaintedRegionId.current) {
        lastPaintedRegionId.current = rid;
        applyPaintToRegion(rid, e.clientX, e.clientY);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isPaintingRef.current) {
      saveHistoryStep(strokeChangesRef.current);
      checkCompletion();
    }

    isPaintingRef.current = false;
    isPanningRef.current = false;
    lastPaintedRegionId.current = -1;
    lastPoint.current = null;
    prevDiff.current = -1;

    const index = evCache.current.findIndex((ev) => ev.pointerId === e.pointerId);
    if (index > -1) evCache.current.splice(index, 1);
  };

  const addRipple = (x: number, y: number, color: string) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const id = Date.now() + Math.random();
      setRipples((prev) => [...prev, { x: x - rect.left, y: y - rect.top, id, color }]);
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 600);
    }
  };

  const resetView = () => {
    if (containerRef.current) {
      const { width: cW, height: cH } = containerRef.current.getBoundingClientRect();
      const scale = Math.min((cW - 40) / width, (cH - 40) / height);
      setTransform({ scale, x: (cW - width * scale) / 2, y: (cH - height * scale) / 2 });
    }
  };

  const download = async () => {
    const url = await generateCompositeImage();
    const link = document.createElement("a");
    link.download = "FifoColor_Art.png";
    link.href = url;
    link.click();
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Controls */}
      <div className="glass-panel rounded-full px-4 py-2 flex items-center gap-4 shadow-lg mb-2 z-10 flex-wrap justify-center">
        <div className="flex bg-gray-100 rounded-full p-1">
          <button
            onClick={() => setMode("paint")}
            className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
              mode === "paint" ? "bg-white shadow text-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <i className={`fa-solid ${isEraser ? "fa-eraser" : "fa-paintbrush"} mr-2`}></i>
            {isEraser ? "Eraser" : "Paint"}
          </button>
          <button
            onClick={() => setMode("move")}
            className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
              mode === "move" ? "bg-white shadow text-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <i className="fa-solid fa-up-down-left-right mr-2"></i> Move
          </button>
        </div>

        <div className="w-px h-6 bg-gray-300"></div>

        {/* Outline controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOutlinesEnabled((v) => !v)}
            className={`w-8 h-8 rounded-full transition-all flex items-center justify-center ${
              outlinesEnabled ? "bg-gray-900 text-white shadow-md" : "hover:bg-gray-100 text-gray-500"
            }`}
            title={outlinesEnabled ? "Hide outlines" : "Show outlines"}
          >
            <i className={`fa-solid ${outlinesEnabled ? "fa-border-all" : "fa-square"}`}></i>
          </button>

          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-bold">Lines</span>
            <input
              type="range"
              min={1}
              max={7}
              value={outlineThicknessPx}
              onChange={(e) => setOutlineThicknessPx(parseInt(e.target.value, 10))}
              className="accent-gray-900"
              title="Outline thickness"
            />
          </div>
        </div>

        <div className="w-px h-6 bg-gray-300"></div>

        <div className="flex gap-2 text-gray-600 items-center">
          {coloredIllustrationUrl && (
            <>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`w-8 h-8 rounded-full transition-all flex items-center justify-center ${
                  showPreview ? "bg-purple-500 text-white shadow-md" : "hover:bg-gray-100 text-gray-500"
                }`}
                title="Toggle Reference Image"
              >
                <i className={`fa-solid ${showPreview ? "fa-eye-slash" : "fa-eye"}`}></i>
              </button>
              <div className="w-px h-6 bg-gray-300 mx-1"></div>
            </>
          )}
          <button
            onClick={() => setTransform((t) => ({ ...t, scale: t.scale * 0.8 }))}
            className="w-8 h-8 hover:bg-gray-100 rounded-full"
          >
            <i className="fa-solid fa-minus"></i>
          </button>
          <button
            onClick={() => setTransform((t) => ({ ...t, scale: t.scale * 1.2 }))}
            className="w-8 h-8 hover:bg-gray-100 rounded-full"
          >
            <i className="fa-solid fa-plus"></i>
          </button>
          <button onClick={resetView} className="w-8 h-8 hover:bg-gray-100 rounded-full text-blue-500">
            <i className="fa-solid fa-compress"></i>
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative bg-gray-100/50 rounded-3xl shadow-inner border border-gray-200 overflow-hidden w-full h-[65vh] touch-none flex items-center justify-center"
        style={{ cursor: mode === "move" ? "grab" : "crosshair" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
            width,
            height,
            position: "absolute",
            top: 0,
            left: 0,
            backgroundColor: "#ffffff",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.08'/%3E%3C/svg%3E")`,
          }}
        >
          {/* LAYER 1: Fill Canvas (Multiply Blend for ink effect) */}
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="absolute inset-0 z-0"
            style={{
              imageRendering: "pixelated",
              mixBlendMode: "multiply",
            }}
          />

          {/* LAYER 2: Hints Canvas */}
          <canvas
            ref={hintsCanvasRef}
            width={width}
            height={height}
            className="absolute inset-0 z-10 pointer-events-none transition-opacity duration-300"
            style={{
              opacity: transform.scale < 0.5 ? 0 : 1,
            }}
          />

          {/* LAYER 3: Outline Canvas (RELIABLE - draws outlines directly) */}
          <canvas
            ref={outlinesCanvasRef}
            width={width}
            height={height}
            className="absolute inset-0 z-20 pointer-events-none"
            style={{
              imageRendering: "auto",
            }}
          />

          {/* LAYER 4: Reference Preview */}
          {coloredIllustrationUrl && showPreview && (
            <img
              id="PreviewLayer"
              src={coloredIllustrationUrl}
              className="absolute inset-0 w-full h-full object-cover z-30 opacity-90"
              style={{ pointerEvents: "none" }}
              crossOrigin="anonymous"
            />
          )}
        </div>

        {ripples.map((r) => (
          <div
            key={r.id}
            className="absolute rounded-full border-2 animate-ping pointer-events-none z-50"
            style={{
              left: r.x,
              top: r.y,
              width: 40,
              height: 40,
              borderColor: r.color,
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </div>

      {/* Undo / Save Buttons */}
      <div className="flex gap-4">
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          className="glass-panel px-8 py-3 rounded-full font-bold text-gray-600"
        >
          <i className="fa-solid fa-rotate-left mr-2"></i> Undo
        </button>
        <button
          onClick={download}
          className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-full font-bold shadow-lg hover:shadow-green-500/50 hover:-translate-y-1 transition-all"
        >
          <i className="fa-solid fa-share-from-square mr-2"></i> Save Art
        </button>
      </div>
    </div>
  );
};

export default DrawingCanvas;
