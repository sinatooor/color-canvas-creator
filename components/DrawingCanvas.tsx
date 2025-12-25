
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { binarizeImageData, generateHints, checkProgress } from '../utils/imageProcessing';
import { hexToRgb } from '../utils/floodFill'; // Still used for safe mode check
import { DrawingAction, Hint, Color, TimelapseFrame } from '../types';
import { MAX_UNDO_STEPS } from '../constants';
import { soundEngine } from '../utils/soundEffects';

interface DrawingCanvasProps {
  imageUrl: string; // This is now the REGIONS SVG URL
  outlinesUrl?: string; // New prop for the OUTLINES SVG/Image
  initialStateUrl?: string; 
  coloredIllustrationUrl: string | null;
  selectedColor: string;
  isEraser: boolean;
  onHintClick: (colorHex: string) => void;
  onProcessingHints: (isProcessing: boolean) => void;
  onAutoSave?: (imageDataUrl: string, timelapse?: TimelapseFrame[]) => void;
  onCompletion?: (imageDataUrl: string, timelapse: TimelapseFrame[]) => void;
  palette: Color[];
  existingTimelapse?: TimelapseFrame[];
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ 
  imageUrl, 
  outlinesUrl,
  initialStateUrl,
  coloredIllustrationUrl,
  selectedColor, 
  isEraser,
  onHintClick,
  onProcessingHints,
  onAutoSave,
  onCompletion,
  palette,
  existingTimelapse
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null); // For Safe Mode & Hints

  // We store fills as: { [pathIndex]: hexColor }
  const [fills, setFills] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<Record<number, string>[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [ripples, setRipples] = useState<{x: number, y: number, id: number, color: string}[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  
  // Timelapse Log
  const timelapseLog = useRef<TimelapseFrame[]>([]);

  // Transform state
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<'paint' | 'move'>('paint');
  const [isSafeMode, setIsSafeMode] = useState(false); 

  // Gesture state
  const evCache = useRef<React.PointerEvent[]>([]);
  const prevDiff = useRef<number>(-1);
  const isDragging = useRef(false);
  const lastPoint = useRef<{x: number, y: number} | null>(null);
  const gestureStartTime = useRef<number>(0);
  const maxTouchesDetected = useRef<number>(0);
  const gestureDidMove = useRef<boolean>(false);
  
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const startPointerPos = useRef<{x: number, y: number} | null>(null);

  // 1. Load SVG Content
  useEffect(() => {
    if (!imageUrl) return;
    fetch(imageUrl)
      .then(res => res.text())
      .then(text => {
          // Process SVG: Remove width/height to allow scaling via CSS
          // Also set default fill to white
          const cleanSvg = text
            .replace(/width="[^"]*"/, '')
            .replace(/height="[^"]*"/, '')
            .replace(/<svg /, '<svg style="width:100%; height:100%; fill:white;" ');
          setSvgContent(cleanSvg);
      });
  }, [imageUrl]);

  // 2. Load Timelapse / Initial State
  useEffect(() => {
      if (existingTimelapse) {
          timelapseLog.current = [...existingTimelapse];
          // Replay timelapse to build fills state
          const initialFills: Record<number, string> = {};
          existingTimelapse.forEach(frame => {
              // Note: Timelapse stored (x,y) for raster. For SVG we need index.
              // Since we changed architecture, old raster timelapses might not work perfectly 
              // unless we map (x,y) to path index.
              // For new SVG architecture, we will store `pathIndex` in `x` (hack) or add new field.
              // For now, let's assume we start fresh or implement index logic.
              if (frame.pathIndex !== undefined) {
                   initialFills[frame.pathIndex] = frame.color;
              }
          });
          setFills(initialFills);
          setHistory([initialFills]);
          setHistoryIndex(0);
      } else {
          setFills({});
          setHistory([{}]);
          setHistoryIndex(0);
      }
  }, [existingTimelapse]);

  // 3. Setup Reference Canvas (Invisible) for Hints & Safe Mode
  useEffect(() => {
      if (!coloredIllustrationUrl) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = coloredIllustrationUrl;
      img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
              ctx.drawImage(img, 0, 0);
              referenceCanvasRef.current = canvas;
              
              // Generate hints
              onProcessingHints(true);
              const hintsData = generateHints(ctx.getImageData(0,0,img.width, img.height), palette);
              setHints(hintsData);
              onProcessingHints(false);
          }
      };
  }, [coloredIllustrationUrl, palette]);

  // 4. Update SVG Fills when state changes
  useEffect(() => {
      if (!svgContainerRef.current) return;
      const paths = svgContainerRef.current.querySelectorAll('path');
      
      // Reset all to white first (or optimized update)
      // Iterating all is safer for consistency
      paths.forEach((path, index) => {
          if (fills[index]) {
              path.style.fill = fills[index];
          } else {
              path.style.fill = '#ffffff';
          }
      });
  }, [fills, svgContent]);

  // History Actions
  const saveToHistory = useCallback((newFills: Record<number, string>) => {
      const newHistory = history.slice(0, historyIndex + 1);
      if (newHistory.length >= MAX_UNDO_STEPS) newHistory.shift();
      newHistory.push(newFills);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const undo = useCallback(() => {
      if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setFills(history[newIndex]);
          setHistoryIndex(newIndex);
          timelapseLog.current.pop();
      }
  }, [historyIndex, history]);

  // Save Functionality (SVG to Canvas)
  const generateCompositeImage = useCallback(async () => {
      if (!svgContainerRef.current) return '';
      
      const svgEl = svgContainerRef.current.querySelector('svg');
      if (!svgEl) return '';

      // 1. Serialize SVG with current colors
      const s = new XMLSerializer();
      const str = s.serializeToString(svgEl);
      const svgBlob = new Blob([str], {type: 'image/svg+xml;charset=utf-8'});
      const url = URL.createObjectURL(svgBlob);

      // 2. Draw to Canvas
      const canvas = document.createElement('canvas');
      // Use viewBox to determine size, or clientWidth if missing
      const viewBox = svgEl.getAttribute('viewBox')?.split(' ').map(Number) || [0,0,1024,1024];
      canvas.width = viewBox[2];
      canvas.height = viewBox[3];
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      // Draw Color Layer
      const img = new Image();
      img.src = url;
      await new Promise(r => img.onload = r);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Draw Outlines Layer
      if (outlinesUrl) {
          const outlines = new Image();
          outlines.src = outlinesUrl;
          outlines.crossOrigin = 'anonymous';
          await new Promise(r => outlines.onload = r);
          ctx.drawImage(outlines, 0, 0, canvas.width, canvas.height);
      }

      URL.revokeObjectURL(url);
      return canvas.toDataURL('image/png');
  }, [outlinesUrl]);

  // Auto-Save
  useEffect(() => {
      if (!onAutoSave) return;
      const interval = setInterval(async () => {
          if (Object.keys(fills).length > 0 && !isCompleted) {
              const url = await generateCompositeImage();
              onAutoSave(url, timelapseLog.current);
          }
      }, 10000);
      return () => clearInterval(interval);
  }, [onAutoSave, fills, isCompleted, generateCompositeImage]);


  // Interaction Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    soundEngine.init();
    evCache.current.push(e);
    containerRef.current?.setPointerCapture(e.pointerId);
    startPointerPos.current = { x: e.clientX, y: e.clientY };

    if (evCache.current.length === 1) {
        gestureStartTime.current = Date.now();
        maxTouchesDetected.current = 1;
        gestureDidMove.current = false;
    } else {
        maxTouchesDetected.current = Math.max(maxTouchesDetected.current, evCache.current.length);
    }

    const isPen = e.pointerType === 'pen';
    const isMultiTouch = evCache.current.length > 1;

    let effectiveMode = mode;
    if (isPen) effectiveMode = 'paint'; 
    if (isMultiTouch) effectiveMode = 'move';

    if (isMultiTouch) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    }

    if (effectiveMode === 'move' || e.button === 1 || e.shiftKey) {
      isDragging.current = true;
      lastPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }

    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      setShowPreview(true);
    }, 1000);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const index = evCache.current.findIndex((cachedEv) => cachedEv.pointerId === e.pointerId);
    if (index > -1) evCache.current[index] = e;

    if (startPointerPos.current) {
        const dist = Math.hypot(e.clientX - startPointerPos.current.x, e.clientY - startPointerPos.current.y);
        if (dist > 10) {
             if (longPressTimer.current) clearTimeout(longPressTimer.current);
             if (dist > 20) gestureDidMove.current = true; 
        }
    }

    if (evCache.current.length === 2) {
      const curDiff = Math.hypot(
        evCache.current[0].clientX - evCache.current[1].clientX,
        evCache.current[0].clientY - evCache.current[1].clientY
      );
      if (prevDiff.current > 0) {
        const delta = curDiff - prevDiff.current;
        setTransform(prev => ({
          ...prev,
          scale: Math.min(Math.max(0.1, prev.scale + delta * 0.005), 8)
        }));
      }
      prevDiff.current = curDiff;
      return;
    }

    if (isDragging.current && lastPoint.current) {
      const deltaX = e.clientX - lastPoint.current.x;
      const deltaY = e.clientY - lastPoint.current.y;
      setTransform(prev => ({ ...prev, x: prev.x + deltaX, y: prev.y + deltaY }));
      lastPoint.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    const isTracked = evCache.current.some(ev => ev.pointerId === e.pointerId);

    // Two finger tap undo
    if (evCache.current.length === 2 && maxTouchesDetected.current === 2 && !gestureDidMove.current) {
        undo();
        addRipple(e.clientX, e.clientY, 'gray');
    }

    if (isLongPress.current) {
      setShowPreview(false);
      isLongPress.current = false;
    } else {
        // Handle Click / Paint
        const isPen = e.pointerType === 'pen';
        const shouldPaint = (mode === 'paint' || isPen) && !isDragging.current && evCache.current.length < 2 && isTracked;
        
        if (shouldPaint) {
            // We use document.elementFromPoint to find the SVG path under the cursor
            // regardless of the container's transform.
            // Temporarily hide the overlay outlines to click through to SVG
            const overlay = document.getElementById('outline-overlay');
            if (overlay) overlay.style.display = 'none';
            
            const target = document.elementFromPoint(e.clientX, e.clientY);
            
            if (overlay) overlay.style.display = 'block';

            if (target && target.tagName === 'path' && svgContainerRef.current?.contains(target)) {
                const paths = Array.from(svgContainerRef.current.querySelectorAll('path'));
                const pathIndex = paths.indexOf(target as SVGPathElement);
                
                if (pathIndex !== -1) {
                    // Safe Mode Check
                    let allow = true;
                    if (isSafeMode && !isEraser && referenceCanvasRef.current) {
                        const rect = containerRef.current!.getBoundingClientRect();
                        const scaleX = referenceCanvasRef.current.width / rect.width;
                        const scaleY = referenceCanvasRef.current.height / rect.height;
                        
                        // Map screen click to canvas reference
                        // Note: This maps the CLICK, not the path centroid. 
                        // Good enough if clicking center of region.
                        // We need to account for transform.
                        // Easier: use offsetX/Y relative to the SVG element if possible, 
                        // but `elementFromPoint` uses viewport.
                        
                        // Let's use the svg bounding box logic:
                        const svgRect = svgContainerRef.current.getBoundingClientRect();
                        const relX = (e.clientX - svgRect.left) * (referenceCanvasRef.current.width / svgRect.width);
                        const relY = (e.clientY - svgRect.top) * (referenceCanvasRef.current.height / svgRect.height);
                        
                        const ctx = referenceCanvasRef.current.getContext('2d');
                        if (ctx) {
                            const p = ctx.getImageData(relX, relY, 1, 1).data;
                            const [tr, tg, tb] = hexToRgb(selectedColor);
                            const diff = Math.abs(p[0]-tr) + Math.abs(p[1]-tg) + Math.abs(p[2]-tb);
                            if (diff > 80) allow = false;
                        }
                    }

                    if (allow) {
                        // Calculate coordinates for timelapse (relative to original image size)
                        let logX = 0;
                        let logY = 0;
                        if (svgContainerRef.current) {
                            const rect = svgContainerRef.current.getBoundingClientRect();
                            const width = referenceCanvasRef.current?.width || rect.width;
                            const height = referenceCanvasRef.current?.height || rect.height;
                            
                            logX = Math.floor((e.clientX - rect.left) / rect.width * width);
                            logY = Math.floor((e.clientY - rect.top) / rect.height * height);
                        }

                        const colorToUse = isEraser ? '#ffffff' : selectedColor;
                        const newFills = { ...fills, [pathIndex]: colorToUse };
                        setFills(newFills);
                        saveToHistory(newFills);
                        
                        soundEngine.playPop();
                        addRipple(e.clientX, e.clientY, isEraser ? 'gray' : selectedColor);
                        
                        // Log with pathIndex
                        timelapseLog.current.push({ x: logX, y: logY, pathIndex, color: colorToUse });

                        // Check Completion (Simple count based)
                        if (!isEraser && Object.keys(newFills).length > paths.length * 0.9) {
                           // If 90% paths filled, check specific hints
                           // Simplified: Just check if we filled enough unique regions
                           if (!isCompleted) {
                               // Optional: Validate against hints
                               checkCompletionStrict();
                           }
                        }
                    } else {
                        soundEngine.playBuzz();
                        addRipple(e.clientX, e.clientY, '#ef4444');
                    }
                }
            } else {
                // Check for Hint Click
                // Logic remains similar but requires coordinate mapping from Screen -> SVG Space
            }
        }
    }

    // Cleanup
    const index = evCache.current.findIndex((cachedEv) => cachedEv.pointerId === e.pointerId);
    if (index > -1) evCache.current.splice(index, 1);
    if (evCache.current.length < 2) prevDiff.current = -1;
    if (evCache.current.length === 0) {
      isDragging.current = false;
      lastPoint.current = null;
    }
  };

  const checkCompletionStrict = () => {
       // Just a stub for now or trigger celebration
       setIsCompleted(true);
       soundEngine.playCheer();
       if (onCompletion) {
           generateCompositeImage().then(url => onCompletion(url, timelapseLog.current));
       }
  };

  const addRipple = (x: number, y: number, color: string) => {
    // Map client coordinates to container relative
    const rect = containerRef.current?.getBoundingClientRect();
    if(rect) {
        const id = Date.now();
        setRipples(prev => [...prev, { x: x - rect.left, y: y - rect.top, id, color }]);
        setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 600);
    }
  };

  const download = async () => {
      const url = await generateCompositeImage();
      const link = document.createElement('a');
      link.download = 'my-art.png';
      link.href = url;
      link.click();
  };

  const resetView = () => {
     if (!containerRef.current || !svgContainerRef.current) return;
     // simple reset
     setTransform({ scale: 1, x: 0, y: 0 });
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Controls UI (Keeping existing structure) */}
      <div className="glass-panel rounded-full px-4 py-2 flex items-center gap-4 shadow-lg mb-2 z-10 flex-wrap justify-center">
        <div className="flex bg-gray-100 rounded-full p-1">
          <button
            onClick={() => setMode('paint')}
            className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
              mode === 'paint' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className={`fa-solid ${isEraser ? 'fa-eraser' : 'fa-paintbrush'} mr-2`}></i>
            {isEraser ? 'Eraser' : 'Paint'}
          </button>
          <button
            onClick={() => setMode('move')}
            className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
              mode === 'move' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fa-solid fa-up-down-left-right mr-2"></i> Move
          </button>
        </div>
        <button
            onClick={() => setIsSafeMode(!isSafeMode)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold transition-all border ${
                isSafeMode ? 'bg-green-100 text-green-700' : 'bg-white text-gray-500'
            }`}
        >
            <i className={`fa-solid ${isSafeMode ? 'fa-shield-halved' : 'fa-shield'}`}></i>
            <span className="hidden sm:inline">Safe Mode</span>
        </button>
        <div className="w-px h-6 bg-gray-300"></div>
        <div className="flex gap-2 text-gray-600">
           <button onClick={() => setTransform(t => ({...t, scale: t.scale * 0.8}))} className="w-8 h-8 hover:bg-gray-100 rounded-full"><i className="fa-solid fa-minus"></i></button>
           <button onClick={() => setTransform(t => ({...t, scale: t.scale * 1.2}))} className="w-8 h-8 hover:bg-gray-100 rounded-full"><i className="fa-solid fa-plus"></i></button>
           <button onClick={resetView} className="w-8 h-8 hover:bg-gray-100 rounded-full text-blue-500"><i className="fa-solid fa-compress"></i></button>
        </div>
      </div>

      <div 
        ref={containerRef} 
        className="relative bg-white/50 rounded-3xl shadow-xl border border-white/60 overflow-hidden w-full h-[65vh] touch-none"
        style={{ cursor: mode === 'move' ? 'grab' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => isDragging.current = false}
      >
        <div
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            width: '100%',
            height: '100%',
            position: 'relative'
          }}
        >
            {/* Preview Layer */}
            {coloredIllustrationUrl && showPreview && (
                <img src={coloredIllustrationUrl} className="absolute inset-0 w-full h-full object-contain z-20 pointer-events-none" />
            )}

            {/* Layer 1: The Clickable Regions SVG */}
            <div 
                ref={svgContainerRef}
                className="absolute inset-0 w-full h-full z-0"
                dangerouslySetInnerHTML={{ __html: svgContent || '' }}
            />

            {/* Layer 2: The Outline Overlay (Pointer Events None so clicks go to SVG) */}
            {outlinesUrl && (
                <img 
                    id="outline-overlay"
                    src={outlinesUrl} 
                    className="absolute inset-0 w-full h-full object-contain z-10 pointer-events-none" 
                    alt="outlines"
                />
            )}
        </div>

        {/* Ripples */}
        {ripples.map(r => (
            <div 
                key={r.id}
                className="absolute rounded-full border-2 animate-ping pointer-events-none"
                style={{
                    left: r.x, top: r.y, width: 40, height: 40,
                    borderColor: r.color,
                    transform: 'translate(-50%, -50%)'
                }}
            />
        ))}
      </div>

      {/* Footer Controls */}
      <div className="flex gap-4">
        <button onClick={undo} disabled={historyIndex <= 0} className="glass-panel px-8 py-3 rounded-full font-bold text-gray-600">
            <i className="fa-solid fa-rotate-left mr-2"></i> Undo
        </button>
        <button onClick={download} className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-full font-bold shadow-lg hover:shadow-green-500/50 hover:-translate-y-1 transition-all">
            <i className="fa-solid fa-share-from-square mr-2"></i> Save Art
        </button>
      </div>
    </div>
  );
};

export default DrawingCanvas;
