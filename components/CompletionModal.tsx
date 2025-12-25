
import React, { useRef, useState, useEffect } from 'react';
import { TimelapseFrame } from '../types';
import { floodFill } from '../utils/floodFill';
import { binarizeImageData, cleanupArtifacts } from '../utils/imageProcessing';
import { soundEngine } from '../utils/soundEffects';

interface CompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  thumbnailUrl: string;
  timelapseLog: TimelapseFrame[];
  baseVectorUrl: string;
}

const CompletionModal: React.FC<CompletionModalProps> = ({ isOpen, onClose, thumbnailUrl, timelapseLog, baseVectorUrl }) => {
  const [mode, setMode] = useState<'static' | 'replay'>('static');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const replayTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
        setMode('static');
    }
  }, [isOpen]);

  const startReplay = () => {
      setMode('replay');
      
      setTimeout(() => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          // 1. Load the base vector image
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = baseVectorUrl;
          img.onload = () => {
              // Ensure canvas matches image dims
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.drawImage(img, 0, 0);
              
              // Ensure clean lines like in editor
              const rawData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const binaryData = binarizeImageData(rawData, 90); 
              const initialData = cleanupArtifacts(binaryData);
              ctx.putImageData(initialData, 0, 0);

              // 2. Start Animation Loop
              let frameIndex = 0;
              const frames = timelapseLog;
              
              // Speed up: calculate delay based on total frames to fit in ~5-10 seconds
              // Max delay 50ms, Min delay 5ms
              const delay = Math.max(5, Math.min(50, 5000 / frames.length));

              const animate = () => {
                  if (frameIndex >= frames.length) {
                      soundEngine.playCheer();
                      return;
                  }

                  // Process a batch of frames per tick to speed up if very long
                  const batchSize = frames.length > 500 ? 5 : 1;
                  
                  for (let i = 0; i < batchSize; i++) {
                     if (frameIndex + i < frames.length) {
                         const f = frames[frameIndex + i];
                         floodFill(ctx, f.x, f.y, f.color);
                         if (i === 0 && frameIndex % 10 === 0) soundEngine.playPop(); // Pop sound occasionally
                     }
                  }
                  
                  frameIndex += batchSize;
                  replayTimeoutRef.current = window.setTimeout(animate, delay);
              };

              animate();
          };
      }, 100);
  };

  const cleanup = () => {
     if (replayTimeoutRef.current) clearTimeout(replayTimeoutRef.current);
     onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in duration-500">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden relative text-center flex flex-col max-h-[90vh]">
        
        {/* Confetti Background Effect (CSS only) */}
        {mode === 'static' && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-0 left-1/4 w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
                <div className="absolute top-10 right-1/4 w-3 h-3 bg-blue-500 rounded-full animate-bounce"></div>
                <div className="absolute bottom-10 left-10 w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            </div>
        )}

        <div className="p-8 pt-10 flex-grow overflow-y-auto relative z-10">
            {mode === 'static' ? (
                <>
                    <div className="w-20 h-20 bg-gradient-to-br from-yellow-300 to-orange-400 rounded-full flex items-center justify-center text-3xl text-white shadow-lg mx-auto mb-6 animate-bounce">
                        <i className="fa-solid fa-trophy"></i>
                    </div>
                    
                    <h2 className="text-3xl font-black text-gray-800 mb-2">Masterpiece!</h2>
                    <p className="text-gray-500 font-medium mb-6">
                        You've completed the artwork.
                    </p>

                    <div className="relative aspect-square w-full max-w-xs mx-auto mb-8 rounded-2xl overflow-hidden shadow-lg border-4 border-white rotate-3 hover:rotate-0 transition-transform duration-300 bg-gray-100">
                        <img src={thumbnailUrl} alt="Finished Art" className="w-full h-full object-cover" />
                    </div>

                    <div className="space-y-3">
                         <button
                            onClick={startReplay}
                            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 hover:shadow-purple-500/30"
                        >
                            <i className="fa-solid fa-clapperboard"></i> Watch Replay
                        </button>
                        
                        <button
                            onClick={cleanup}
                            className="w-full py-4 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                            <i className="fa-solid fa-check"></i> Done
                        </button>
                    </div>
                </>
            ) : (
                <div className="flex flex-col h-full justify-center">
                    <h3 className="text-xl font-bold mb-4 text-purple-600 animate-pulse">Speed Painting...</h3>
                    <div className="relative w-full aspect-square bg-white rounded-xl shadow-inner border border-gray-200 overflow-hidden">
                        <canvas ref={canvasRef} className="w-full h-full object-contain" />
                    </div>
                    <button 
                        onClick={() => setMode('static')}
                        className="mt-6 text-gray-400 hover:text-gray-600 font-bold"
                    >
                        Cancel Replay
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default CompletionModal;
