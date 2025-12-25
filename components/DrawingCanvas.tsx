
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { binarizeImageData, generateHints, checkProgress } from '../utils/imageProcessing';
import { hexToRgb } from '../utils/floodFill'; 
import { DrawingAction, Hint, Color, TimelapseFrame } from '../types';
import { MAX_UNDO_STEPS } from '../constants';
import { soundEngine } from '../utils/soundEffects';

interface DrawingCanvasProps {
  imageUrl: string; 
  outlinesUrl?: string; 
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
  width?: number;
  height?: number;
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
  existingTimelapse,
  width = 1024,
  height = 1024
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [fills, setFills] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<Record<number, string>[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [ripples, setRipples] = useState<{x: number, y: number, id: number, color: string}[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  
  const timelapseLog = useRef<TimelapseFrame[]>([]);

  // Initial Transform State: Scale to fit, positioned at 0,0 relative to origin
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<'paint' | 'move'>('paint');
  const [isSafeMode, setIsSafeMode] = useState(false); 

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

  // 1. Initial Fit Logic
  useEffect(() => {
    if (containerRef.current && width > 0 && height > 0) {
        const { width: cW, height: cH } = containerRef.current.getBoundingClientRect();
        // Add some padding (20px)
        const availW = cW - 40;
        const availH = cH - 40;
        
        const scaleX = availW / width;
        const scaleY = availH / height;
        const fitScale = Math.min(scaleX, scaleY);
        
        // Center the fitted image
        const x = (cW - width * fitScale) / 2;
        const y = (cH - height * fitScale) / 2;

        setTransform({ scale: fitScale, x, y });
    }
  }, [width, height]);

  // 2. Load and Process SVG
  useEffect(() => {
    if (!imageUrl) return;
    
    const processSvgString = (text: string) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'image/svg+xml');
        const svg = doc.querySelector('svg');
        if (!svg) return text;

        // Force dimensions to match container
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        
        // Inject styles
        const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = `path, polygon, rect { fill: #ffffff; stroke: none; vector-effect: non-scaling-stroke; cursor: pointer; }`;
        svg.prepend(style);

        // Split Compound Paths for Individual Coloring
        const paths = Array.from(svg.querySelectorAll('path'));
        paths.forEach(p => {
            const d = p.getAttribute('d');
            // If path contains multiple Move commands, it likely has disjoint subpaths
            if (d && (d.match(/[mM]/g) || []).length > 1) {
                // Split by 'z' or 'Z' (close path) followed by 'm' or 'M'
                // This regex finds segments that start with m/M and end with z/Z
                const subPaths = d.match(/([mM][^zZ]*[zZ])/g);
                if (subPaths && subPaths.length > 0) {
                    subPaths.forEach(sp => {
                        const newP = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
                        newP.setAttribute('d', sp);
                        p.parentNode?.insertBefore(newP, p);
                    });
                    p.remove();
                }
            }
        });

        return new XMLSerializer().serializeToString(doc);
    };

    if (imageUrl.startsWith('data:image/svg+xml;base64,')) {
        try {
            const base64 = imageUrl.split(',')[1];
            const text = atob(base64);
            setSvgContent(processSvgString(text));
        } catch (e) {
            console.error("Failed to decode SVG", e);
        }
    } else {
        fetch(imageUrl)
        .then(res => res.text())
        .then(text => setSvgContent(processSvgString(text)))
        .catch(err => console.error("Failed to fetch SVG", err));
    }
  }, [imageUrl]);

  // 3. Load Timelapse
  useEffect(() => {
      if (existingTimelapse) {
          timelapseLog.current = [...existingTimelapse];
          const initialFills: Record<number, string> = {};
          existingTimelapse.forEach(frame => {
              if (frame.pathIndex !== undefined) initialFills[frame.pathIndex] = frame.color;
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

  // 4. Setup Reference Canvas
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
              onProcessingHints(true);
              setHints(generateHints(ctx.getImageData(0,0,img.width, img.height), palette));
              onProcessingHints(false);
          }
      };
  }, [coloredIllustrationUrl, palette]);

  // 5. Update Fills
  useEffect(() => {
      if (!svgContainerRef.current) return;
      const paths = svgContainerRef.current.querySelectorAll('path');
      paths.forEach((path, index) => {
          path.style.fill = fills[index] || '#ffffff';
      });
  }, [fills, svgContent]);

  // History & Save Actions (unchanged logic, just ensuring function stability)
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

  const generateCompositeImage = useCallback(async () => {
      if (!svgContainerRef.current) return '';
      const svgEl = svgContainerRef.current.querySelector('svg');
      if (!svgEl) return '';

      const s = new XMLSerializer();
      const str = s.serializeToString(svgEl);
      const svgBlob = new Blob([str], {type: 'image/svg+xml;charset=utf-8'});
      const url = URL.createObjectURL(svgBlob);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      const img = new Image();
      img.src = url;
      await new Promise(r => img.onload = r);
      ctx.drawImage(img, 0, 0, width, height);

      if (outlinesUrl) {
          const outlines = new Image();
          outlines.src = outlinesUrl;
          outlines.crossOrigin = 'anonymous';
          await new Promise(r => outlines.onload = r);
          ctx.drawImage(outlines, 0, 0, width, height);
      }
      URL.revokeObjectURL(url);
      return canvas.toDataURL('image/png');
  }, [outlinesUrl, width, height]);

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

  // --- Interaction Handlers ---

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

    // Determine mode
    const isPen = e.pointerType === 'pen';
    const isMultiTouch = evCache.current.length > 1;

    // Auto-switch to move if using 2 fingers
    if (isMultiTouch) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    }

    if (mode === 'move' || isMultiTouch || e.button === 1 || e.shiftKey) {
      isDragging.current = true;
      lastPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Setup Long Press for Preview
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      setShowPreview(true);
    }, 600); // 600ms long press
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const index = evCache.current.findIndex((cachedEv) => cachedEv.pointerId === e.pointerId);
    if (index > -1) evCache.current[index] = e;

    if (startPointerPos.current) {
        const dist = Math.hypot(e.clientX - startPointerPos.current.x, e.clientY - startPointerPos.current.y);
        if (dist > 8) { // Threshold for "drag" vs "click"
             if (longPressTimer.current) clearTimeout(longPressTimer.current);
             if (dist > 15) gestureDidMove.current = true; 
        }
    }

    // Pinch Zoom
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

    // Pan
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
        const isClick = !isDragging.current && !gestureDidMove.current && evCache.current.length < 2 && isTracked;
        const shouldPaint = (mode === 'paint' || isPen) && isClick;
        
        if (shouldPaint) {
            // Hide Overlays
            const overlay = document.getElementById('outline-overlay');
            if (overlay) overlay.style.display = 'none';
            const preview = document.getElementById('preview-overlay');
            if (preview) preview.style.display = 'none';
            
            // Hit Test
            const target = document.elementFromPoint(e.clientX, e.clientY);
            
            // Restore Overlays
            if (overlay) overlay.style.display = 'block';
            if (preview) preview.style.display = (showPreview ? 'block' : 'none');

            // Logic: Check if we hit a path
            // Note: SVG paths inside svgContainerRef
            if (target && target.tagName.toLowerCase() === 'path' && svgContainerRef.current?.contains(target)) {
                const paths = Array.from(svgContainerRef.current.querySelectorAll('path'));
                const pathIndex = paths.indexOf(target as SVGPathElement);
                
                if (pathIndex !== -1) {
                    const colorToUse = isEraser ? '#ffffff' : selectedColor;
                    const newFills = { ...fills, [pathIndex]: colorToUse };
                    setFills(newFills);
                    saveToHistory(newFills);
                    
                    soundEngine.playPop();
                    addRipple(e.clientX, e.clientY, isEraser ? 'gray' : selectedColor);
                    timelapseLog.current.push({ x: 0, y: 0, pathIndex, color: colorToUse });

                    if (!isEraser && Object.keys(newFills).length > paths.length * 0.95) {
                       if (!isCompleted) checkCompletionStrict();
                    }
                }
            }
        }
    }

    const index = evCache.current.findIndex((cachedEv) => cachedEv.pointerId === e.pointerId);
    if (index > -1) evCache.current.splice(index, 1);
    if (evCache.current.length < 2) prevDiff.current = -1;
    if (evCache.current.length === 0) {
      isDragging.current = false;
      lastPoint.current = null;
    }
  };

  const checkCompletionStrict = () => {
       setIsCompleted(true);
       soundEngine.playCheer();
       if (onCompletion) {
           generateCompositeImage().then(url => onCompletion(url, timelapseLog.current));
       }
  };

  const addRipple = (x: number, y: number, color: string) => {
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
    if (containerRef.current) {
        const { width: cW, height: cH } = containerRef.current.getBoundingClientRect();
        const scale = Math.min((cW-40)/width, (cH-40)/height);
        setTransform({ 
            scale, 
            x: (cW - width * scale) / 2, 
            y: (cH - height * scale) / 2 
        });
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Controls UI */}
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
        className="relative bg-gray-100/50 rounded-3xl shadow-inner border border-gray-200 overflow-hidden w-full h-[65vh] touch-none flex items-center justify-center"
        style={{ cursor: mode === 'move' ? 'grab' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => isDragging.current = false}
      >
        {/* The Scalable Canvas Wrapper */}
        <div
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0', // Changed to Top Left for easier coordinate mapping
            width: width,   
            height: height, 
            position: 'absolute', // Absolute to allow free movement via translate
            top: 0,
            left: 0,
            backgroundColor: '#ffffff',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
          }}
        >
            {/* Preview Layer (Z-20) */}
            {coloredIllustrationUrl && showPreview && (
                <img 
                    id="preview-overlay"
                    src={coloredIllustrationUrl} 
                    className="absolute inset-0 w-full h-full object-cover z-20 pointer-events-none" 
                />
            )}

            {/* Layer 1: The Clickable Regions SVG (Z-0) */}
            <div 
                ref={svgContainerRef}
                className="absolute inset-0 w-full h-full z-0"
                dangerouslySetInnerHTML={{ __html: svgContent || '' }}
            />

            {/* Layer 2: The Outline Overlay (Z-10) */}
            {outlinesUrl && (
                <img 
                    id="outline-overlay"
                    src={outlinesUrl} 
                    className="absolute inset-0 w-full h-full object-cover z-10 pointer-events-none" 
                    alt="outlines"
                />
            )}
        </div>

        {/* Ripples */}
        {ripples.map(r => (
            <div 
                key={r.id}
                className="absolute rounded-full border-2 animate-ping pointer-events-none z-50"
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
