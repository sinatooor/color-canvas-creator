
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { floodFill, hexToRgb } from '../utils/floodFill';
import { binarizeImageData, generateHints, cleanupArtifacts, checkProgress } from '../utils/imageProcessing';
import { DrawingAction, Hint, Color } from '../types';
import { MAX_UNDO_STEPS } from '../constants';

interface DrawingCanvasProps {
  imageUrl: string; // The base vector URL (used for dimensions/reset)
  initialStateUrl?: string; // Optional: The saved progress to resume
  coloredIllustrationUrl: string | null;
  selectedColor: string;
  isEraser: boolean;
  onHintClick: (colorHex: string) => void;
  onProcessingHints: (isProcessing: boolean) => void;
  onAutoSave?: (imageDataUrl: string) => void;
  onCompletion?: (imageDataUrl: string) => void;
  palette: Color[];
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ 
  imageUrl, 
  initialStateUrl,
  coloredIllustrationUrl,
  selectedColor, 
  isEraser,
  onHintClick,
  onProcessingHints,
  onAutoSave,
  onCompletion,
  palette
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const referenceDataRef = useRef<ImageData | null>(null); // Stores the "Answer Key"

  const [history, setHistory] = useState<DrawingAction[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [hints, setHints] = useState<Hint[]>([]);
  const [ripples, setRipples] = useState<{x: number, y: number, id: number, color: string}[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  
  // Transform state
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<'paint' | 'move'>('paint');
  const [isSafeMode, setIsSafeMode] = useState(false); // Magic Shield Toggle

  // Gesture state
  const evCache = useRef<React.PointerEvent[]>([]);
  const prevDiff = useRef<number>(-1);
  const isDragging = useRef(false);
  const lastPoint = useRef<{x: number, y: number} | null>(null);
  
  // Undo Gesture State (Two-finger tap)
  const gestureStartTime = useRef<number>(0);
  const maxTouchesDetected = useRef<number>(0);
  const gestureDidMove = useRef<boolean>(false);
  
  // Long press for preview
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const startPointerPos = useRef<{x: number, y: number} | null>(null);

  // Initialize Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = initialStateUrl || imageUrl;
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      
      ctx.drawImage(img, 0, 0);
      
      let initialData: ImageData;

      if (!initialStateUrl) {
          const rawData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const binaryData = binarizeImageData(rawData, 90); 
          initialData = cleanupArtifacts(binaryData);
          ctx.putImageData(initialData, 0, 0);
      } else {
          initialData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      
      setHistory([{ imageData: initialData }]);
      setHistoryIndex(0);
      setIsCompleted(false);

      if (containerRef.current) {
        const container = containerRef.current;
        const scaleX = container.clientWidth / img.width;
        const scaleY = (window.innerHeight * 0.65) / img.height;
        const initialScale = Math.min(scaleX, scaleY, 0.9);
        
        const x = (container.clientWidth - img.width * initialScale) / 2;
        const y = ((window.innerHeight * 0.65) - img.height * initialScale) / 2;
        setTransform({ scale: initialScale, x, y });
      }

      onProcessingHints(true);
      setTimeout(() => {
        const generatedHints = generateHints(initialData, palette);
        setHints(generatedHints);
        onProcessingHints(false);
      }, 300);
    };
  }, [imageUrl, initialStateUrl, palette]);

  // Load Reference Image for Safe Mode
  useEffect(() => {
    if (!coloredIllustrationUrl) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = coloredIllustrationUrl;
    img.onload = () => {
        const refCanvas = document.createElement('canvas');
        refCanvas.width = img.width;
        refCanvas.height = img.height;
        const ctx = refCanvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0);
            referenceDataRef.current = ctx.getImageData(0, 0, img.width, img.height);
        }
    };
  }, [coloredIllustrationUrl]);

  // Auto-save Interval
  useEffect(() => {
    if (!onAutoSave) return;
    const intervalId = setInterval(() => {
      if (canvasRef.current && historyIndex >= 0 && !isCompleted) {
        const dataUrl = canvasRef.current.toDataURL('image/png');
        onAutoSave(dataUrl);
      }
    }, 10000); 

    return () => clearInterval(intervalId);
  }, [onAutoSave, historyIndex, isCompleted]);

  // History management
  const saveToHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const newHistory = history.slice(0, historyIndex + 1);
    
    if (newHistory.length >= MAX_UNDO_STEPS) newHistory.shift();
    
    newHistory.push({ imageData: currentState });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        ctx.putImageData(history[newIndex].imageData, 0, 0);
        setHistoryIndex(newIndex);
      }
    }
  }, [historyIndex, history]);

  const checkAndHandleCompletion = (ctx: CanvasRenderingContext2D) => {
    if (isCompleted || !onCompletion) return;
    
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const done = checkProgress(imageData, hints);
    
    if (done) {
        setIsCompleted(true);
        setTimeout(() => {
            onCompletion(ctx.canvas.toDataURL('image/png'));
        }, 500);
    }
  };

  const addRipple = (x: number, y: number, color: string) => {
    const id = Date.now();
    setRipples(prev => [...prev, { x, y, id, color }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 600);
  };

  const cleanupPointer = (pointerId: number) => {
    const index = evCache.current.findIndex((cachedEv) => cachedEv.pointerId === pointerId);
    if (index > -1) {
      evCache.current.splice(index, 1);
    }
    
    if (evCache.current.length < 2) {
      prevDiff.current = -1;
    }
    
    if (evCache.current.length === 0) {
      isDragging.current = false;
      lastPoint.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    evCache.current.push(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
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
    if (index > -1) {
      evCache.current[index] = e;
    }

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
        const zoomFactor = delta * 0.005;
        
        setTransform(prev => ({
          ...prev,
          scale: Math.min(Math.max(0.1, prev.scale + zoomFactor), 8)
        }));
      }
      prevDiff.current = curDiff;
      return;
    }

    if (isDragging.current && lastPoint.current) {
      const deltaX = e.clientX - lastPoint.current.x;
      const deltaY = e.clientY - lastPoint.current.y;
      
      setTransform(prev => ({
        ...prev,
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      
      lastPoint.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    
    const isTracked = evCache.current.some(ev => ev.pointerId === e.pointerId);

    if (evCache.current.length === 2) { 
        const duration = Date.now() - gestureStartTime.current;
        if (maxTouchesDetected.current === 2 && duration < 300 && !gestureDidMove.current) {
            undo();
            addRipple(e.clientX - containerRef.current!.getBoundingClientRect().left, e.clientY - containerRef.current!.getBoundingClientRect().top, 'gray');
            cleanupPointer(e.pointerId);
            return;
        }
    }

    if (isLongPress.current) {
      setShowPreview(false);
      isLongPress.current = false;
      cleanupPointer(e.pointerId);
      return;
    }

    const isPen = e.pointerType === 'pen';
    const shouldPaint = (mode === 'paint' || isPen) && !isDragging.current && evCache.current.length < 2 && isTracked;

    if (shouldPaint) {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (canvas.width / rect.width);
                const y = (e.clientY - rect.top) * (canvas.height / rect.height);

                let hintClicked = false;
                if (transform.scale > 1.5) {
                    const clickRadius = 20 / transform.scale; 
                    const clickedHint = hints.find(h => 
                        Math.abs(h.x - x) < clickRadius && Math.abs(h.y - y) < clickRadius
                    );
                    if (clickedHint) {
                        onHintClick(clickedHint.colorHex);
                        hintClicked = true;
                    }
                }

                if (!hintClicked) {
                    const ix = Math.round(x);
                    const iy = Math.round(y);
                    
                    // --- SAFE MODE CHECK ---
                    let allowFill = true;
                    if (isSafeMode && !isEraser && referenceDataRef.current) {
                        const refData = referenceDataRef.current.data;
                        const idx = (iy * referenceDataRef.current.width + ix) * 4;
                        
                        // Reference pixel color
                        const refR = refData[idx];
                        const refG = refData[idx+1];
                        const refB = refData[idx+2];
                        
                        // Selected color
                        const [selR, selG, selB] = hexToRgb(selectedColor);
                        
                        // Calculate difference (Euclidean distance approximation)
                        // Tolerance covers jpeg compression artifacts and palette quantization
                        const diff = Math.abs(refR - selR) + Math.abs(refG - selG) + Math.abs(refB - selB);
                        
                        // Threshold of 60 allows for slight variations but blocks distinct colors
                        if (diff > 60) {
                            allowFill = false;
                        }
                    }

                    if (!allowFill) {
                        // REJECT: Wrong color
                        addRipple(e.clientX - containerRef.current!.getBoundingClientRect().left, e.clientY - containerRef.current!.getBoundingClientRect().top, '#ef4444'); // Red
                    } else {
                        // ALLOW
                        const colorToUse = isEraser ? '#FFFFFF' : selectedColor;
                        const didPaint = floodFill(ctx, ix, iy, colorToUse);
                        if (didPaint) {
                            saveToHistory();
                            addRipple(e.clientX - containerRef.current!.getBoundingClientRect().left, e.clientY - containerRef.current!.getBoundingClientRect().top, isEraser ? 'gray' : selectedColor);
                            
                            if (!isEraser && hints.length > 0) {
                                checkAndHandleCompletion(ctx);
                            }
                        }
                    }
                }
            }
        }
    }

    cleanupPointer(e.pointerId);
  };
  
  const handlePointerLeave = (e: React.PointerEvent) => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (showPreview) setShowPreview(false);
      isLongPress.current = false;
      cleanupPointer(e.pointerId); 
  }

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'fifocolor-masterpiece.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const resetView = () => {
     if (!containerRef.current || !canvasRef.current) return;
     const img = canvasRef.current;
     const container = containerRef.current;
     const scaleX = container.clientWidth / img.width;
     const scaleY = (window.innerHeight * 0.65) / img.height;
     const initialScale = Math.min(scaleX, scaleY, 0.9);
     const x = (container.clientWidth - img.width * initialScale) / 2;
     const y = ((window.innerHeight * 0.65) - img.height * initialScale) / 2;
     setTransform({ scale: initialScale, x, y });
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Floating Controls */}
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

        {/* Magic Shield / Safe Mode Toggle */}
        <button
            onClick={() => setIsSafeMode(!isSafeMode)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold transition-all border ${
                isSafeMode 
                ? 'bg-green-100 text-green-700 border-green-200 shadow-inner' 
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
            title="Safe Mode: Prevents using the wrong color"
        >
            <i className={`fa-solid ${isSafeMode ? 'fa-shield-halved' : 'fa-shield'}`}></i>
            <span className="hidden sm:inline">Safe Mode</span>
        </button>

        <div className="w-px h-6 bg-gray-300"></div>

        <div className="flex gap-2 text-gray-600">
           <button onClick={() => setTransform(t => ({...t, scale: Math.max(0.2, t.scale * 0.8)}))} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center">
             <i className="fa-solid fa-minus"></i>
           </button>
           <span className="text-xs font-mono self-center w-12 text-center">{Math.round(transform.scale * 100)}%</span>
           <button onClick={() => setTransform(t => ({...t, scale: Math.min(8, t.scale * 1.2)}))} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center">
             <i className="fa-solid fa-plus"></i>
           </button>
           <button onClick={resetView} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-blue-500">
             <i className="fa-solid fa-compress"></i>
           </button>
        </div>
      </div>

      <div 
        ref={containerRef} 
        className="relative bg-white/50 rounded-3xl shadow-xl border border-white/60 overflow-hidden w-full h-[65vh] touch-none"
        style={{ cursor: mode === 'move' ? 'grab' : (isEraser ? 'url(https://cdn-icons-png.flaticon.com/32/2661/2661282.png) 4 14, auto' : 'crosshair') }}
      >
        <div
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            width: canvasRef.current?.width || 'auto',
            height: canvasRef.current?.height || 'auto',
            position: 'relative',
            willChange: 'transform' // GPU optim
          }}
        >
          {/* Preview Overlay */}
          {coloredIllustrationUrl && (
             <img 
               src={coloredIllustrationUrl}
               alt="Preview"
               style={{
                   position: 'absolute',
                   top: 0,
                   left: 0,
                   width: '100%',
                   height: '100%',
                   opacity: showPreview ? 1 : 0,
                   transition: 'opacity 0.2s ease-in-out',
                   pointerEvents: 'none',
                   zIndex: 20
               }}
             />
          )}

          <canvas 
            ref={canvasRef} 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            className="shadow-2xl bg-white"
            style={{ imageRendering: 'pixelated', touchAction: 'none' }} 
          />
          
          {/* Magic Hints Overlay */}
          {transform.scale > 1.8 && !showPreview && !isCompleted && (
            <div className="absolute inset-0 pointer-events-none">
              {hints.map((hint, i) => (
                <div
                  key={i}
                  className="absolute flex items-center justify-center font-bold select-none transition-opacity duration-300"
                  style={{
                    left: hint.x,
                    top: hint.y,
                    transform: `translate(-50%, -50%) scale(${1/transform.scale * 1.5})`, // Keep size relative
                    color: '#94a3b8',
                    textShadow: '0 0 2px white',
                    fontSize: '14px',
                  }}
                >
                  <span className="bg-white/80 rounded-full w-5 h-5 flex items-center justify-center shadow-sm border border-gray-100">
                    {hint.number}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ripple Effects Container */}
        {ripples.map(r => (
            <div 
                key={r.id}
                className={`absolute rounded-full border-2 pointer-events-none ${r.color === '#ef4444' ? 'animate-bounce' : 'animate-ping'}`}
                style={{
                    left: r.x,
                    top: r.y,
                    width: '40px',
                    height: '40px',
                    transform: 'translate(-50%, -50%)',
                    borderColor: r.color,
                    borderWidth: r.color === '#ef4444' ? '4px' : '2px', // Thicker border for error
                    opacity: 0.8
                }}
            >
                {/* Add an X icon if it is an error ripple */}
                {r.color === '#ef4444' && (
                    <div className="absolute inset-0 flex items-center justify-center text-red-500 text-lg">
                        <i className="fa-solid fa-xmark"></i>
                    </div>
                )}
            </div>
        ))}
        
        {/* Preview Indicator */}
        {isLongPress.current && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 text-white px-4 py-2 rounded-full backdrop-blur-sm text-sm font-bold animate-pulse pointer-events-none">
                Preview Mode
            </div>
        )}
      </div>

      <div className="flex gap-4">
        <button 
          onClick={undo}
          disabled={historyIndex <= 0}
          className="glass-panel px-8 py-3 rounded-full font-bold text-gray-600 hover:text-gray-800 disabled:opacity-50 transition-all active:scale-95 flex items-center gap-2"
        >
          <i className="fa-solid fa-rotate-left"></i> Undo <span className="text-xs font-normal opacity-70 hidden md:inline">(2-finger tap)</span>
        </button>
        <button 
          onClick={download}
          className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-full font-bold shadow-lg shadow-green-500/30 hover:shadow-green-500/50 hover:-translate-y-1 transition-all active:scale-95 flex items-center gap-2"
        >
          <i className="fa-solid fa-share-from-square"></i> Save Art
        </button>
      </div>
    </div>
  );
};

export default DrawingCanvas;
