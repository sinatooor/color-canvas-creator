import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Color, TimelapseFrame } from "../types";
import { MAX_UNDO_STEPS } from "../constants";
import { soundEngine } from "../utils/soundEffects";
import {
  GLResources,
  initGL,
  uploadLabels,
  uploadWall,
  uploadPalette,
  draw,
  hexToRgba8,
  clamp,
} from "../utils/webglUtils";

interface WorkerResult {
  width: number;
  height: number;
  regionCount: number;
  labels: Uint16Array;
  wall: Uint8Array;
}

interface LeakProofCanvasProps {
  imageUrl: string;
  selectedColor: string;
  isEraser: boolean;
  palette: Color[];
  initialRegionColors?: Record<number, string>;
  existingTimelapse?: TimelapseFrame[];
  onAutoSave?: (imageDataUrl: string, regionColors: Record<number, string>, timelapse?: TimelapseFrame[]) => void;
  onCompletion?: (imageDataUrl: string, timelapse: TimelapseFrame[]) => void;
  onProcessingChange?: (processing: boolean) => void;
}

const DEFAULT_PARAMS = {
  outlineBlackRgbDistance: 40,
  maxGapPx: 10,
  thickenPx: 1,
  closeKernelPx: 7,
  openKernelPx: 3,
  endpointBridge: {
    enabled: true,
    maxEndpointDistancePx: 12,
    maxBridgesPerMegapixel: 200,
    angleLimitDegrees: 35,
  },
  colorEdgeWalls: {
    enabled: true,
    minColorDeltaL2: 25,
    dilatePx: 1,
  },
  leakValidation: {
    enabled: true,
    smallIslandTolerancePx: 50,
    strengthenOnce: true,
  },
};

async function loadImageToRGBA(url: string): Promise<{
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });
  
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  
  return {
    rgba: imageData.data,
    width: img.width,
    height: img.height,
  };
}

const LeakProofCanvas: React.FC<LeakProofCanvasProps> = ({
  imageUrl,
  selectedColor,
  isEraser,
  palette,
  initialRegionColors = {},
  existingTimelapse,
  onAutoSave,
  onCompletion,
  onProcessingChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ stage: "", pct: 0 });
  const [result, setResult] = useState<WorkerResult | null>(null);
  const [paletteData, setPaletteData] = useState<Uint8Array | null>(null);
  const [regionColors, setRegionColors] = useState<Record<number, string>>(initialRegionColors);
  const [isCompleted, setIsCompleted] = useState(false);
  
  // History for undo
  const [history, setHistory] = useState<Record<number, string>[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Timelapse
  const timelapseLog = useRef<TimelapseFrame[]>(existingTimelapse || []);
  
  // Transform state
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  
  // Interaction refs
  const isPanningRef = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const evCache = useRef<React.PointerEvent[]>([]);
  const prevDiff = useRef(-1);
  
  const glrRef = useRef<GLResources | null>(null);
  
  const worker = useMemo(() => {
    return new Worker(new URL("../workers/leakProof.worker.ts", import.meta.url), {
      type: "module",
    });
  }, []);
  
  // Cleanup worker
  useEffect(() => {
    return () => worker.terminate();
  }, [worker]);
  
  // Initialize WebGL
  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      glrRef.current = initGL(canvasRef.current);
    } catch (err) {
      console.error("WebGL2 initialization failed:", err);
    }
  }, []);
  
  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      if (result && glrRef.current) {
        draw(glrRef.current, result.width, result.height);
      }
    };
    
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [result]);
  
  // Process image when URL changes
  useEffect(() => {
    if (!imageUrl) return;
    
    const runProcessing = async () => {
      setProcessing(true);
      setResult(null);
      onProcessingChange?.(true);
      
      try {
        const { rgba, width, height } = await loadImageToRGBA(imageUrl);
        
        const msg = {
          type: "PROCESS",
          payload: {
            rgba: rgba.buffer,
            width,
            height,
            params: DEFAULT_PARAMS,
          },
        };
        
        worker.postMessage(msg, [rgba.buffer]);
        
        worker.onmessage = (ev: MessageEvent) => {
          const { type, payload } = ev.data;
          
          if (type === "DONE") {
            const workerResult = payload as WorkerResult;
            setResult(workerResult);
            
            // Build initial palette (all white)
            const pal = new Uint8Array(workerResult.regionCount * 4);
            for (let i = 0; i < workerResult.regionCount; i++) {
              pal[i * 4 + 0] = 255;
              pal[i * 4 + 1] = 255;
              pal[i * 4 + 2] = 255;
              pal[i * 4 + 3] = 255;
            }
            
            // Apply initial colors
            Object.entries(initialRegionColors).forEach(([idStr, color]) => {
              const id = parseInt(idStr, 10);
              const [r, g, b, a] = hexToRgba8(color as string);
              pal[id * 4 + 0] = r;
              pal[id * 4 + 1] = g;
              pal[id * 4 + 2] = b;
              pal[id * 4 + 3] = a;
            });
            
            setPaletteData(pal);
            
            // Upload to WebGL
            const glr = glrRef.current!;
            uploadLabels(glr, workerResult.labels, workerResult.width, workerResult.height);
            uploadWall(glr, workerResult.wall, workerResult.width, workerResult.height);
            uploadPalette(glr, pal, workerResult.regionCount);
            draw(glr, workerResult.width, workerResult.height);
            
            // Fit to container
            if (containerRef.current) {
              const { width: cW, height: cH } = containerRef.current.getBoundingClientRect();
              const availW = cW - 40;
              const availH = cH - 40;
              const scaleX = availW / workerResult.width;
              const scaleY = availH / workerResult.height;
              const fitScale = Math.min(scaleX, scaleY);
              const x = (cW - workerResult.width * fitScale) / 2;
              const y = (cH - workerResult.height * fitScale) / 2;
              setTransform({ scale: fitScale, x, y });
            }
            
            // Initialize history
            setHistory([initialRegionColors]);
            setHistoryIndex(0);
            
            setProcessing(false);
            onProcessingChange?.(false);
          } else if (type === "PROGRESS") {
            setProgress(payload);
          } else if (type === "ERROR") {
            console.error("Worker error:", payload);
            setProcessing(false);
            onProcessingChange?.(false);
          }
        };
      } catch (err) {
        console.error("Processing failed:", err);
        setProcessing(false);
        onProcessingChange?.(false);
      }
    };
    
    runProcessing();
  }, [imageUrl, worker, initialRegionColors, onProcessingChange]);
  
  const saveHistoryStep = useCallback(
    (newColors: Record<number, string>) => {
      const newHistory = history.slice(0, historyIndex + 1);
      if (newHistory.length >= MAX_UNDO_STEPS) newHistory.shift();
      newHistory.push(newColors);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [history, historyIndex]
  );
  
  const undo = useCallback(() => {
    if (historyIndex > 0 && result && paletteData) {
      const newIndex = historyIndex - 1;
      const prevColors = history[newIndex];
      setRegionColors(prevColors);
      setHistoryIndex(newIndex);
      timelapseLog.current.pop();
      
      // Rebuild palette
      const pal = new Uint8Array(result.regionCount * 4);
      for (let i = 0; i < result.regionCount; i++) {
        pal[i * 4 + 0] = 255;
        pal[i * 4 + 1] = 255;
        pal[i * 4 + 2] = 255;
        pal[i * 4 + 3] = 255;
      }
      Object.entries(prevColors).forEach(([idStr, color]) => {
        const id = parseInt(idStr, 10);
        const [r, g, b, a] = hexToRgba8(color as string);
        pal[id * 4 + 0] = r;
        pal[id * 4 + 1] = g;
        pal[id * 4 + 2] = b;
        pal[id * 4 + 3] = a;
      });
      
      setPaletteData(pal);
      const glr = glrRef.current!;
      uploadPalette(glr, pal, result.regionCount);
      draw(glr, result.width, result.height);
    }
  }, [historyIndex, history, result, paletteData]);
  
  const generateCompositeImage = useCallback((): string => {
    if (!canvasRef.current) return "";
    return canvasRef.current.toDataURL("image/png");
  }, []);
  
  // Auto-save
  useEffect(() => {
    if (!onAutoSave || !result) return;
    const interval = setInterval(() => {
      if (Object.keys(regionColors).length > 0 && !isCompleted) {
        const url = generateCompositeImage();
        onAutoSave(url, regionColors, timelapseLog.current);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [onAutoSave, regionColors, isCompleted, generateCompositeImage, result]);
  
  const checkCompletion = useCallback(() => {
    if (!result) return;
    const coloredCount = Object.keys(regionColors).length;
    if (result.regionCount > 10 && coloredCount > result.regionCount * 0.95 && !isCompleted) {
      setIsCompleted(true);
      soundEngine.playCheer();
      if (onCompletion) {
        const url = generateCompositeImage();
        onCompletion(url, timelapseLog.current);
      }
    }
  }, [result, regionColors, isCompleted, onCompletion, generateCompositeImage]);
  
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!result || !paletteData || processing) return;
    
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    
    // Convert click to normalized UV
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Apply inverse transform
    const imageX = clamp(
      Math.floor((clickX - transform.x) / transform.scale),
      0,
      result.width - 1
    );
    const imageY = clamp(
      Math.floor((clickY - transform.y) / transform.scale),
      0,
      result.height - 1
    );
    
    const idx = imageY * result.width + imageX;
    
    // Clicked on wall
    if (result.wall[idx] > 0) return;
    
    const regionId = result.labels[idx];
    if (regionId === 0) return;
    
    const [r, g, b, a] = isEraser ? [255, 255, 255, 255] : hexToRgba8(selectedColor);
    
    // Update palette
    const newPal = new Uint8Array(paletteData);
    newPal[regionId * 4 + 0] = r;
    newPal[regionId * 4 + 1] = g;
    newPal[regionId * 4 + 2] = b;
    newPal[regionId * 4 + 3] = a;
    
    setPaletteData(newPal);
    
    // Update region colors state
    const newColors = { ...regionColors };
    if (isEraser) {
      delete newColors[regionId];
    } else {
      newColors[regionId] = selectedColor;
    }
    setRegionColors(newColors);
    saveHistoryStep(newColors);
    
    // Log timelapse
    timelapseLog.current.push({
      x: imageX,
      y: imageY,
      regionId,
      color: isEraser ? "TRANSPARENT" : selectedColor,
    });
    
    // Play sound
    soundEngine.playPop();
    
    // Upload and redraw
    const glr = glrRef.current!;
    uploadPalette(glr, newPal, result.regionCount);
    draw(glr, result.width, result.height);
    
    checkCompletion();
  };
  
  // Pan/zoom handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    containerRef.current?.setPointerCapture(e.pointerId);
    evCache.current.push(e);
    
    if (evCache.current.length > 1 || e.button === 1) {
      isPanningRef.current = true;
      lastPoint.current = { x: e.clientX, y: e.clientY };
    }
  };
  
  const handlePointerMove = (e: React.PointerEvent) => {
    const index = evCache.current.findIndex((ev) => ev.pointerId === e.pointerId);
    if (index > -1) evCache.current[index] = e;
    
    if (!isPanningRef.current) return;
    
    if (evCache.current.length === 2) {
      const curDiff = Math.hypot(
        evCache.current[0].clientX - evCache.current[1].clientX,
        evCache.current[0].clientY - evCache.current[1].clientY
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
  };
  
  const handlePointerUp = (e: React.PointerEvent) => {
    evCache.current = evCache.current.filter((ev) => ev.pointerId !== e.pointerId);
    if (evCache.current.length < 2) {
      prevDiff.current = -1;
    }
    if (evCache.current.length === 0) {
      isPanningRef.current = false;
      lastPoint.current = null;
    }
  };
  
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({
      ...t,
      scale: Math.min(Math.max(0.1, t.scale * delta), 8),
    }));
  };
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo]);
  
  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-gray-100 rounded-2xl"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      {processing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-20">
          <div className="w-16 h-16 mb-4 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
          <p className="text-lg font-semibold text-gray-700">{progress.stage}</p>
          <div className="w-48 h-2 mt-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}
      
      <div
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "top left",
          width: result?.width || 800,
          height: result?.height || 600,
        }}
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="block cursor-crosshair"
          style={{
            width: result?.width || 800,
            height: result?.height || 600,
          }}
        />
      </div>
      
      {result && !processing && (
        <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black/60 text-white text-xs rounded-lg">
          {result.width}×{result.height} • {result.regionCount} regions • {Object.keys(regionColors).length} colored
        </div>
      )}
    </div>
  );
};

export default LeakProofCanvas;
