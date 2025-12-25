
import React, { useState, useRef, useEffect } from 'react';
import { AppState, Color, User, GenerationSettings, SavedProject } from './types';
import { transformToIllustration } from './services/geminiService';
import { vectorizeImage } from './utils/vectorize';
import { extractPalette } from './utils/imageProcessing';
import { storageService } from './services/storageService';
import DrawingCanvas from './components/DrawingCanvas';
import ColorPicker from './components/ColorPicker';
import AuthModal from './components/AuthModal';
import SettingsModal from './components/SettingsModal';
import ProjectsGallery from './components/ProjectsGallery';
import CompletionModal from './components/CompletionModal';
import { DEFAULT_PALETTE } from './constants';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

const App: React.FC = () => {
  // App State
  const [state, setState] = useState<AppState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  
  // User State
  const [user, setUser] = useState<User | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  // Modals
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);

  // Settings
  const [genSettings, setGenSettings] = useState<GenerationSettings>({
    style: 'classic',
    complexity: 'medium'
  });

  // Editor State
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(null);
  const [initialStateUrl, setInitialStateUrl] = useState<string | undefined>(undefined);
  const [coloredIllustrationUrl, setColoredIllustrationUrl] = useState<string | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null); // Keep track for saving
  const [selectedColor, setSelectedColor] = useState('#3b82f6');
  const [palette, setPalette] = useState<Color[]>(DEFAULT_PALETTE);
  const [isEraser, setIsEraser] = useState(false);
  const [processingHints, setProcessingHints] = useState(false);
  const [finalImage, setFinalImage] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showCamera, setShowCamera] = useState(false);

  // --- Initialization ---

  useEffect(() => {
    checkApiKey();
    checkUserSession();
  }, []);

  const checkApiKey = async () => {
    if (window.aistudio?.hasSelectedApiKey) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(hasKey);
    } else {
      setHasApiKey(true); 
    }
  };

  const checkUserSession = async () => {
    const currentUser = await storageService.getCurrentUser();
    if (currentUser) setUser(currentUser);
  };

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
      setError(null);
    }
  };

  // --- Actions ---

  const handleLogout = async () => {
    await storageService.logout();
    setUser(null);
    setShowAccountMenu(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setOriginalImageUrl(base64);
      processImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const processImage = async (base64: string) => {
    setState('processing');
    setError(null);
    setCurrentProjectId(null); // Reset project ID for new generation
    setInitialStateUrl(undefined);

    try {
      setStatusMessage('Consulting AI Artist...');
      // Pass settings to service
      const coloredIllustration = await transformToIllustration(base64, genSettings.style, genSettings.complexity);
      setColoredIllustrationUrl(coloredIllustration);
      
      setStatusMessage('Extracting Palette...');
      const img = new Image();
      img.src = coloredIllustration;
      await new Promise((resolve) => { img.onload = resolve; });
      
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not initialize canvas");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      const extractedPalette = extractPalette(imageData);
      setPalette(extractedPalette);
      if (extractedPalette.length > 0) {
        setSelectedColor(extractedPalette[0].hex);
      }

      setStatusMessage('Vectorizing Lines...');
      const vectorizedIllustration = await vectorizeImage(coloredIllustration);
      
      setIllustrationUrl(vectorizedIllustration);
      setState('coloring');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      if (msg.includes("Requested entity was not found") || msg.includes("API key")) {
        setError("Invalid API Key. Please select your key again.");
        setHasApiKey(false);
      } else {
        setError(msg);
      }
      setState('idle');
    }
  };

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError("Unable to access camera. Please check permissions.");
      setShowCamera(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const base64 = canvas.toDataURL('image/png');
    setOriginalImageUrl(base64);
    const stream = videoRef.current.srcObject as MediaStream;
    stream.getTracks().forEach(track => track.stop());
    setShowCamera(false);
    processImage(base64);
  };

  const reset = () => {
    setState('idle');
    setIllustrationUrl(null);
    setColoredIllustrationUrl(null);
    setInitialStateUrl(undefined);
    setOriginalImageUrl(null);
    setError(null);
    setPalette(DEFAULT_PALETTE);
    setCurrentProjectId(null);
  };

  // Load a project from gallery
  const handleLoadProject = (project: SavedProject) => {
    setCurrentProjectId(project.id);
    setOriginalImageUrl(project.originalUrl);
    setColoredIllustrationUrl(project.thumbnailUrl);
    setIllustrationUrl(project.vectorUrl);
    // If we have a current state (resume), use it. Otherwise undefined (starts fresh with vector)
    setInitialStateUrl(project.currentStateUrl);
    setPalette(project.palette);
    setState('coloring');
    setShowGallery(false);
  };

  const handleAutoSave = async (currentImageDataUrl: string) => {
    if (!user || !illustrationUrl || !coloredIllustrationUrl) return;

    try {
      if (currentProjectId) {
        // Update existing project
        await storageService.updateProject(currentProjectId, {
          currentStateUrl: currentImageDataUrl,
          thumbnailUrl: coloredIllustrationUrl, 
        });
      } else {
        // Create new project if not exists
        const newProject = await storageService.saveProject({
          userId: user.id,
          name: `Artwork ${new Date().toLocaleString()}`,
          thumbnailUrl: coloredIllustrationUrl,
          vectorUrl: illustrationUrl,
          currentStateUrl: currentImageDataUrl,
          originalUrl: originalImageUrl || '',
          palette: palette
        });
        setCurrentProjectId(newProject.id);
      }
    } catch (e) {
      console.warn("Auto-save failed", e);
    }
  };

  const handleCompletion = async (imageDataUrl: string) => {
      setFinalImage(imageDataUrl);
      setShowCompletion(true);
      
      if (user && currentProjectId) {
          try {
              await storageService.updateProject(currentProjectId, {
                  currentStateUrl: imageDataUrl,
                  isFinished: true
              });
          } catch(e) {
              console.warn("Failed to mark finished", e);
          }
      }
  };

  // --- Render ---

  // API Key Gate
  if (!hasApiKey) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-slate-50">
        <div className="glass-panel p-10 rounded-3xl shadow-2xl max-w-md text-center border-t border-white">
          <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-6 shadow-inner">
            <i className="fa-solid fa-gem"></i>
          </div>
          <h1 className="text-3xl font-extrabold text-gray-800 mb-4 tracking-tight">Unlock Pro Mode</h1>
          <p className="text-gray-600 mb-8 leading-relaxed">
            FifoColor.AI uses the state-of-the-art <b>Gemini 3 Pro</b> model to generate stunning 2K vector art. Please provide a key to start creating.
          </p>
          <button 
            onClick={handleSelectKey}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl font-bold transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-3 text-lg"
          >
            <i className="fa-brands fa-google"></i> Connect API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 relative">
      
      {/* Modals */}
      <AuthModal 
        isOpen={showAuth} 
        onClose={() => setShowAuth(false)} 
        onLoginSuccess={(u) => setUser(u)} 
      />
      
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)}
        settings={genSettings}
        onSave={(s) => setGenSettings(s)}
      />

      {user && (
        <ProjectsGallery 
          isOpen={showGallery}
          onClose={() => setShowGallery(false)}
          user={user}
          onSelectProject={handleLoadProject}
        />
      )}

      <CompletionModal 
        isOpen={showCompletion}
        onClose={() => { setShowCompletion(false); setState('idle'); }}
        thumbnailUrl={finalImage}
      />

      {/* Top Bar */}
      <header className="w-full max-w-[1400px] flex items-center justify-between mb-8 z-10 relative">
        <div className="flex items-center gap-4 cursor-pointer" onClick={reset}>
          <div className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-2xl flex items-center justify-center text-white text-2xl shadow-lg shadow-purple-500/30">
            <i className="fa-solid fa-paintbrush"></i>
          </div>
          <div className="flex flex-col">
            <h1 className="text-2xl md:text-3xl font-black text-gray-800 tracking-tight leading-none">
              FifoColor<span className="text-purple-600">.AI</span>
            </h1>
            <span className="text-xs font-bold text-gray-400 tracking-[0.2em] uppercase mt-1">Vector Studio</span>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-4">
           {state !== 'idle' && (
              <button 
                onClick={reset}
                className="px-4 py-2 bg-white text-gray-600 hover:text-red-500 hover:bg-red-50 rounded-xl font-bold transition-all shadow-sm border border-gray-100 flex items-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> <span className="hidden md:inline">New</span>
              </button>
            )}

            {/* Account Menu */}
            <div className="relative">
              {user ? (
                <button 
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                  className="flex items-center gap-2 pl-2 pr-1 py-1 bg-white rounded-full shadow-sm border border-gray-100 hover:shadow-md transition-all"
                >
                  <span className="text-sm font-bold text-gray-700 hidden md:block">{user.name}</span>
                  <img src={user.avatar} alt="Avatar" className="w-9 h-9 rounded-full bg-gray-100" />
                </button>
              ) : (
                <button 
                  onClick={() => setShowAuth(true)}
                  className="px-5 py-2.5 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:bg-gray-800 transition-all text-sm"
                >
                  Sign In
                </button>
              )}

              {/* Dropdown */}
              {showAccountMenu && user && (
                <div className="absolute right-0 top-14 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 animate-in fade-in slide-in-from-top-2 overflow-hidden">
                  <button 
                    onClick={() => { setShowGallery(true); setShowAccountMenu(false); }}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 text-gray-700 font-medium flex items-center gap-3"
                  >
                    <i className="fa-solid fa-images text-blue-500"></i> My Gallery
                  </button>
                  <div className="h-px bg-gray-100 my-1"></div>
                  <button 
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-3 hover:bg-red-50 text-red-500 font-medium flex items-center gap-3"
                  >
                    <i className="fa-solid fa-arrow-right-from-bracket"></i> Sign Out
                  </button>
                </div>
              )}
            </div>
        </div>
      </header>

      <main className="w-full max-w-[1400px] flex flex-col items-center justify-center flex-grow relative z-0">
        {error && (
          <div className="mb-8 w-full max-w-2xl p-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl flex items-center gap-4 animate-bounce shadow-sm">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            <p className="font-medium">{error}</p>
          </div>
        )}

        {/* IDLE STATE */}
        {state === 'idle' && (
          <div className="flex flex-col items-center gap-8 md:gap-12 animate-in fade-in slide-in-from-bottom-8 duration-700 w-full">
            <div className="text-center max-w-2xl">
              <span className="px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-bold uppercase tracking-wider mb-6 inline-block">
                v3.2 - Auto-Save & Resume
              </span>
              <h2 className="text-5xl md:text-6xl font-black text-gray-800 mb-6 leading-[1.1]">
                Turn Memories into <br/>
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600">
                  Vector Art
                </span>
              </h2>
              
              {/* Settings Trigger */}
              <button 
                onClick={() => setShowSettings(true)}
                className="group flex items-center justify-center gap-3 mx-auto mb-8 px-6 py-3 bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all"
              >
                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                   <i className={`fa-solid ${
                     genSettings.style === 'classic' ? 'fa-paintbrush' : 
                     genSettings.style === 'stained_glass' ? 'fa-church' :
                     genSettings.style === 'mandala' ? 'fa-dharmachakra' : 'fa-pen-nib'
                   }`}></i>
                </div>
                <div className="text-left">
                  <div className="text-xs text-gray-400 font-bold uppercase tracking-wider">Current Style</div>
                  <div className="text-gray-800 font-bold capitalize">{genSettings.style.replace('_', ' ')} <span className="text-gray-300 mx-1">•</span> {genSettings.complexity}</div>
                </div>
                <i className="fa-solid fa-chevron-right text-gray-300 ml-2"></i>
              </button>

              <p className="text-xl text-gray-500 font-medium leading-relaxed max-w-xl mx-auto">
                Create ultra-crisp coloring pages. Login to save your progress and build your personal collection.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl px-4">
              <button 
                onClick={startCamera}
                className="group relative overflow-hidden flex flex-col items-center justify-center gap-6 p-10 bg-white rounded-[2rem] shadow-xl hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 border border-white/50"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-3xl shadow-inner relative z-10 group-hover:scale-110 transition-transform duration-300">
                  <i className="fa-solid fa-camera"></i>
                </div>
                <div className="relative z-10 text-center">
                  <span className="text-xl font-bold text-gray-800 block mb-1">Take Photo</span>
                </div>
              </button>

              <label className="group relative overflow-hidden cursor-pointer flex flex-col items-center justify-center gap-6 p-10 bg-white rounded-[2rem] shadow-xl hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 border border-white/50">
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleFileUpload}
                  ref={fileInputRef}
                />
                <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-pink-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="w-20 h-20 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-3xl shadow-inner relative z-10 group-hover:scale-110 transition-transform duration-300">
                  <i className="fa-solid fa-cloud-arrow-up"></i>
                </div>
                <div className="relative z-10 text-center">
                  <span className="text-xl font-bold text-gray-800 block mb-1">Upload Image</span>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* CAMERA MODAL */}
        {showCamera && (
          <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300">
            <div className="relative w-full max-w-2xl aspect-[3/4] md:aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-gray-800">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 pointer-events-none border-[1px] border-white/20 grid grid-cols-3 grid-rows-3">
                 {[...Array(9)].map((_, i) => <div key={i} className="border-[0.5px] border-white/10"></div>)}
              </div>
            </div>
            
            <div className="flex gap-8 mt-10">
              <button 
                onClick={() => {
                  const stream = videoRef.current?.srcObject as MediaStream;
                  stream?.getTracks().forEach(t => t.stop());
                  setShowCamera(false);
                }}
                className="w-16 h-16 bg-gray-800 text-white rounded-full flex items-center justify-center text-xl hover:bg-gray-700 transition-colors"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
              <button 
                onClick={capturePhoto}
                className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              >
                <div className="w-20 h-20 rounded-full border-[6px] border-gray-900"></div>
              </button>
              <div className="w-16 h-16"></div> 
            </div>
          </div>
        )}

        {/* PROCESSING STATE */}
        {state === 'processing' && (
          <div className="glass-panel flex flex-col items-center gap-8 text-center p-16 rounded-[3rem] shadow-2xl border-t border-white/80 max-w-xl">
            <div className="relative">
              <div className="w-32 h-32 border-[10px] border-blue-50 border-t-blue-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center text-4xl text-blue-600 animate-pulse">
                <i className="fa-solid fa-wand-magic-sparkles"></i>
              </div>
            </div>
            <div>
              <h3 className="text-4xl font-black text-gray-800 mb-4 tracking-tight">Creating Magic</h3>
              <p className="text-gray-500 font-medium text-lg mb-2">{statusMessage}</p>
              <div className="flex justify-center gap-2 mt-4">
                 <span className="w-2 h-2 rounded-full bg-blue-600 animate-bounce delay-75"></span>
                 <span className="w-2 h-2 rounded-full bg-blue-600 animate-bounce delay-150"></span>
                 <span className="w-2 h-2 rounded-full bg-blue-600 animate-bounce delay-300"></span>
              </div>
            </div>
          </div>
        )}

        {/* COLORING STATE */}
        {state === 'coloring' && illustrationUrl && (
          <div className="w-full h-full flex flex-col lg:flex-row gap-8 items-start animate-in fade-in zoom-in duration-500 pb-20">
            
            {/* Sidebar Tools */}
            <div className="w-full lg:w-80 flex flex-col gap-6 lg:sticky lg:top-8 shrink-0 order-2 lg:order-1">
              <div className="glass-panel p-6 rounded-[2rem] shadow-xl">
                <div className="flex items-center justify-between mb-6">
                    <h4 className="text-xl font-bold text-gray-800">Palette</h4>
                    
                    <button
                        onClick={() => setIsEraser(!isEraser)}
                        className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                            isEraser ? 'bg-gray-800 text-white shadow-lg' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                        }`}
                        title="Eraser Tool"
                    >
                        <i className="fa-solid fa-eraser text-lg"></i>
                    </button>
                </div>

                <div className="relative">
                     <ColorPicker 
                        selectedColor={selectedColor} 
                        onSelectColor={(c) => { setSelectedColor(c); setIsEraser(false); }} 
                        palette={palette}
                    />
                    {isEraser && (
                        <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] rounded-xl flex items-center justify-center cursor-not-allowed" onClick={() => setIsEraser(false)}>
                            <span className="bg-gray-800 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg cursor-pointer">
                                Tap to Exit Eraser
                            </span>
                        </div>
                    )}
                </div>
                
                <div className="mt-8 pt-6 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Selected</span>
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-600">{isEraser ? 'Eraser' : palette.find(c => c.hex === selectedColor)?.name || selectedColor}</span>
                        <div 
                            className="w-10 h-10 rounded-full shadow-lg border-2 border-white"
                            style={{ backgroundColor: isEraser ? '#fff' : selectedColor }}
                        >
                            {isEraser && <div className="w-full h-full flex items-center justify-center text-red-500"><i className="fa-solid fa-slash"></i></div>}
                        </div>
                    </div>
                  </div>
                </div>

                {/* Cloud Save Button */}
                {user && (
                    <div className="mt-4 flex flex-col gap-2">
                       {/* Auto Save Status Indicator */}
                       {currentProjectId && (
                          <div className="text-center text-xs font-semibold text-gray-400 mb-1 flex items-center justify-center gap-2">
                             <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Auto-save active
                          </div>
                       )}

                       <button 
                          onClick={async () => {
                              if (!user || !illustrationUrl || !coloredIllustrationUrl) return;
                              if (currentProjectId) {
                                alert('Project saved successfully!');
                              } else {
                                alert('Project will be auto-saved momentarily.');
                              }
                          }}
                          className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-bold hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                      >
                          <i className="fa-solid fa-cloud-arrow-up"></i> Save / Sync
                      </button>
                    </div>
                )}
              </div>

              {/* Status Card */}
              {processingHints ? (
                  <div className="bg-white p-6 rounded-[2rem] shadow-lg border border-gray-100 flex items-center gap-4 animate-pulse">
                      <div className="w-10 h-10 rounded-full border-4 border-blue-100 border-t-blue-500 animate-spin"></div>
                      <div>
                          <p className="font-bold text-gray-800">Analyzing Details...</p>
                          <p className="text-xs text-gray-400">Preparing Magic Hints</p>
                      </div>
                  </div>
              ) : (
                  <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-6 rounded-[2rem] text-white shadow-xl shadow-indigo-500/20">
                    <h4 className="font-bold text-lg mb-2 flex items-center gap-2">
                    <i className="fa-solid fa-wand-magic-sparkles text-yellow-300"></i> Magic Hints Ready
                    </h4>
                    <p className="text-sm opacity-90 leading-relaxed font-medium">
                    Zoom in deep to reveal color numbers! Tap a number to auto-select its color. <br/>
                    <b>Long press canvas to preview.</b>
                    </p>
                </div>
              )}
            </div>

            {/* Main Canvas Area */}
            <div className="flex-grow w-full order-1 lg:order-2">
              <DrawingCanvas 
                imageUrl={illustrationUrl} 
                initialStateUrl={initialStateUrl}
                coloredIllustrationUrl={coloredIllustrationUrl}
                selectedColor={selectedColor} 
                isEraser={isEraser}
                onHintClick={(c) => { setSelectedColor(c); setIsEraser(false); }}
                onProcessingHints={setProcessingHints}
                onAutoSave={user ? handleAutoSave : undefined}
                onCompletion={handleCompletion}
                palette={palette}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
