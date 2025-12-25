
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { floodFill } from '../utils/floodFill';
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
  const [history, setHistory] = useState<DrawingAction[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [hints, setHints] = useState<Hint[]>([]);
  const [ripples, setRipples] = useState<{x: number, y: number, id: number}[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  
  // Transform state
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<'paint' | 'move'>('paint');

  // Gesture state
  const evCache = useRef<React.PointerEvent[]>([]);
  const prevDiff = useRef<number>(-1);
  const isDragging = useRef(false);
  const lastPoint = useRef<{x: number, y: number} | null>(null);
  
  // Long press for preview
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const startPointerPos = useRef<{x: number, y: number} | null>(null);

  // Initialize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    // If we have a saved state, load that. Otherwise load the base vector image.
    img.src = initialStateUrl || imageUrl;
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      
      ctx.drawImage(img, 0, 0);
      
      // Clean up the image:
      // 1. Get raw data
      const rawData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // 2. Binarize (Strict B&W)
      const binaryData = binarizeImageData(rawData);
      // 3. Despeckle (Remove noise/artifacts)
      const cleanData = cleanupArtifacts(binaryData);
      
      ctx.putImageData(cleanData, 0, 0);
      
      setHistory([{ imageData: cleanData }]);
      setHistoryIndex(0);
      setIsCompleted(false);

      // Fit to screen
      if (containerRef.current) {
        const container = containerRef.current;
        const scaleX = container.clientWidth / img.width;
        const scaleY = (window.innerHeight * 0.65) / img.height;
        const initialScale = Math.min(scaleX, scaleY, 0.9);
        
        const x = (container.clientWidth - img.width * initialScale) / 2;
        const y = ((window.innerHeight * 0.65) - img.height * initialScale) / 2;
        setTransform({ scale: initialScale, x, y });
      }

      // Generate Hints Async using the provided palette
      onProcessingHints(true);
      setTimeout(() => {
        const generatedHints = generateHints(cleanData, palette);
        setHints(generatedHints);
        onProcessingHints(false);
      }, 300);
    };
  }, [imageUrl, initialStateUrl, palette]);

  // Auto-save Interval
  useEffect(() => {
    if (!onAutoSave) return;

    const intervalId = setInterval(() => {
      if (canvasRef.current && historyIndex >= 0 && !isCompleted) {
        const dataUrl = canvasRef.current.toDataURL('image/png');
        onAutoSave(dataUrl);
      }
    }, 10000); // 10 seconds

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

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        ctx.putImageData(history[newIndex].imageData, 0, 0);
        setHistoryIndex(newIndex);
      }
    }
  };

  // --- Interaction Handlers ---

  const checkAndHandleCompletion = (ctx: CanvasRenderingContext2D) => {
    if (isCompleted || !onCompletion) return;
    
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const done = checkProgress(imageData, hints);
    
    if (done) {
        setIsCompleted(true);
        // Delay slightly for effect
        setTimeout(() => {
            onCompletion(ctx.canvas.toDataURL('image/png'));
        }, 500);
    }
  };

  const addRipple = (x: number, y: number) => {
    const id = Date.now();
    setRipples(prev => [...prev, { x, y, id }]);
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

    // Cancel long press if multi-touch
    if (evCache.current.length === 2) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      setMode('move'); 
      return;
    }

    if (mode === 'move' || e.button === 1 || e.shiftKey) {
      isDragging.current = true;
      lastPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Start Long Press Timer (1 second)
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

    // Cancel long press if moved significantly
    if (startPointerPos.current && !isLongPress.current) {
        const dist = Math.hypot(e.clientX - startPointerPos.current.x, e.clientY - startPointerPos.current.y);
        if (dist > 10) {
             if (longPressTimer.current) clearTimeout(longPressTimer.current);
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
    
    // Check if pointer is active (was down)
    const isTracked = evCache.current.some(ev => ev.pointerId === e.pointerId);

    if (isLongPress.current) {
      setShowPreview(false);
      isLongPress.current = false;
      cleanupPointer(e.pointerId);
      return;
    }

    // Normal paint logic if we weren't dragging/pinching and it was a tracked pointer
    if (isTracked && !isDragging.current && evCache.current.length < 2) {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (canvas.width / rect.width);
                const y = (e.clientY - rect.top) * (canvas.height / rect.height);

                // Hint Check
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

                // Flood Fill
                if (!hintClicked) {
                    const colorToUse = isEraser ? '#FFFFFF' : selectedColor;
                    const didPaint = floodFill(ctx, Math.round(x), Math.round(y), colorToUse);
                    if (didPaint) {
                        saveToHistory();
                        addRipple(e.clientX - containerRef.current!.getBoundingClientRect().left, e.clientY - containerRef.current!.getBoundingClientRect().top);
                        
                        // Check completion if we are not erasing
                        if (!isEraser && hints.length > 0) {
                            checkAndHandleCompletion(ctx);
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
      cleanupPointer(e.pointerId); // Just cleanup, never paint on leave
  }

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'colorify-masterpiece.png';
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
      <div className="glass-panel rounded-full px-4 py-2 flex items-center gap-4 shadow-lg mb-2 z-10">
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
            style={{ imageRendering: 'pixelated' }} 
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
                className="absolute rounded-full border-2 border-white pointer-events-none animate-ping"
                style={{
                    left: r.x,
                    top: r.y,
                    width: '40px',
                    height: '40px',
                    transform: 'translate(-50%, -50%)',
                    borderColor: isEraser ? 'gray' : selectedColor,
                    opacity: 0.8
                }}
            />
        ))}
        
        {/* Preview Indicator / Instruction */}
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
          <i className="fa-solid fa-rotate-left"></i> Undo
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
