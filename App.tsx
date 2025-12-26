
import React, { useState, useRef, useEffect } from 'react';
import { AppState, User, GenerationSettings, SavedProject, TimelapseFrame, ProjectBundle, OutlineThickness } from './types';
import { storageService } from './services/storageService';
import { useJobProcessor } from './hooks/useJobProcessor';
import { outlineService } from './services/outlineService';
import { computeLabelMap } from './utils/labeling';
import DrawingCanvas from './components/DrawingCanvas';
import ColorPicker from './components/ColorPicker';
import AuthModal from './components/AuthModal';
import SettingsModal from './components/SettingsModal';
import ProjectsGallery from './components/ProjectsGallery';
import CompletionModal from './components/CompletionModal';

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
  // --- Architecture: Separation of Concerns ---
  // The UI Layer (App.tsx) only handles View State. 
  // The Logic Layer (useJobProcessor) handles the AI/Image Pipeline.
  const { activeJob, error: jobError, startJob, resetJob } = useJobProcessor();

  // --- State: Application Flow ---
  const [state, setState] = useState<AppState>('idle');
  
  // --- State: Editor Context ---
  const [activeBundle, setActiveBundle] = useState<ProjectBundle | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  
  // Editor Session State
  const [selectedColor, setSelectedColor] = useState('#3b82f6');
  const [outlineColor, setOutlineColor] = useState('#000000'); // Default Black Outlines
  const [isEraser, setIsEraser] = useState(false);
  const [processingHints, setProcessingHints] = useState(false);
  const [finalImage, setFinalImage] = useState<string>('');
  const [finalTimelapse, setFinalTimelapse] = useState<TimelapseFrame[]>([]);
  
  const [currentRegionColors, setCurrentRegionColors] = useState<Record<number, string>>({});
  const [currentTimelapse, setCurrentTimelapse] = useState<TimelapseFrame[] | undefined>(undefined);
  const [initialStateUrl, setInitialStateUrl] = useState<string | undefined>(undefined);

  // --- State: User & UI ---
  const [user, setUser] = useState<User | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

  // Modals
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);

  // Settings
  const [genSettings, setGenSettings] = useState<GenerationSettings>({
    style: 'classic',
    complexity: 'medium',
    thickness: 'medium'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showCamera, setShowCamera] = useState(false);

  // --- Initialization ---

  useEffect(() => {
    checkApiKey();
    checkUserSession();
  }, []);

  // Sync Job Error to UI Error
  useEffect(() => {
    if (jobError) {
        if (jobError.includes("API key")) {
            setUiError("Invalid API Key. Please select your key again.");
            setHasApiKey(false);
        } else {
            setUiError(jobError);
        }
    }
  }, [jobError]);

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
      setUiError(null);
    }
  };

  // --- Process Flow ---

  const handleProcessImage = (base64: string) => {
      // Reset Editor State
      setCurrentProjectId(null); 
      setInitialStateUrl(undefined);
      setCurrentTimelapse(undefined);
      setCurrentRegionColors({});
      setUiError(null);
      setOutlineColor('#000000'); // Reset outline color

      // Start Pipeline
      setState('job_running');
      startJob(base64, genSettings, (bundle) => {
          // Success Callback
          setTimeout(() => {
            loadBundleIntoEditor(bundle);
          }, 800);
      });
  };

  const loadBundleIntoEditor = (bundle: ProjectBundle) => {
    setActiveBundle(bundle);
    setSelectedColor(bundle.palette[0]?.hex || '#000000');
    setState('editor');
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
      handleProcessImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setUiError("Unable to access camera. Please check permissions.");
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
    const stream = videoRef.current.srcObject as MediaStream;
    stream.getTracks().forEach(track => track.stop());
    setShowCamera(false);
    handleProcessImage(base64);
  };

  const reset = () => {
    setState('idle');
    resetJob();
    setActiveBundle(null);
    setUiError(null);
    setCurrentProjectId(null);
    setCurrentTimelapse(undefined);
    setCurrentRegionColors({});
  };

  const handleLoadProject = (project: SavedProject) => {
    setCurrentProjectId(project.id);
    setInitialStateUrl(project.currentStateUrl);
    setCurrentTimelapse(project.timelapseLog);
    if (project.regionColors) {
        setCurrentRegionColors(project.regionColors);
    } else {
        setCurrentRegionColors({});
    }
    loadBundleIntoEditor(project.bundle);
    setShowGallery(false);
  };

  const handleAutoSave = async (currentImageDataUrl: string, regionColors: Record<number, string>, timelapseLog?: TimelapseFrame[]) => {
    if (!user || !activeBundle) return;

    try {
      if (currentProjectId) {
        await storageService.updateProject(currentProjectId, {
          currentStateUrl: currentImageDataUrl,
          thumbnailUrl: activeBundle.assets.coloredPreviewUrl, 
          timelapseLog,
          regionColors
        });
      } else {
        const newProject = await storageService.saveProject({
          userId: user.id,
          name: activeBundle.manifest.name,
          thumbnailUrl: activeBundle.assets.coloredPreviewUrl,
          bundle: activeBundle, 
          currentStateUrl: currentImageDataUrl,
          timelapseLog,
          regionColors
        });
        setCurrentProjectId(newProject.id);
      }
    } catch (e) {
      console.warn("Auto-save failed", e);
    }
  };

  const handleCompletion = async (imageDataUrl: string, timelapseLog: TimelapseFrame[]) => {
      setFinalImage(imageDataUrl);
      setFinalTimelapse(timelapseLog);
      setShowCompletion(true);
      
      if (user && currentProjectId) {
          try {
              await storageService.updateProject(currentProjectId, {
                  currentStateUrl: imageDataUrl,
                  timelapseLog: timelapseLog,
                  isFinished: true
              });
          } catch(e) {
              console.warn("Failed to mark finished", e);
          }
      }
  };
  
  const handleOutlineChange = async (newThickness: OutlineThickness) => {
      if (!activeBundle) return;
      if (newThickness === genSettings.thickness) return; 

      const confirmReset = Object.keys(currentRegionColors).length === 0 || window.confirm("Changing outline thickness will reset your coloring progress. Continue?");
      if (!confirmReset) return;

      setProcessingHints(true); 
      
      setTimeout(async () => {
          try {
             const img = new Image();
             img.crossOrigin = 'anonymous';
             img.src = activeBundle.assets.coloredPreviewUrl;
             await new Promise(r => img.onload = r);
             
             const canvas = document.createElement('canvas');
             canvas.width = img.width;
             canvas.height = img.height;
             const ctx = canvas.getContext('2d');
             if (!ctx) throw new Error("Canvas context failed");
             ctx.drawImage(img, 0, 0);
             const imageData = ctx.getImageData(0, 0, img.width, img.height);

             const repairedImageData = outlineService.processAndRepairImage(imageData, newThickness);
             const outlinesSvg = await outlineService.generateLeakProofOutlines(imageData, newThickness);
             const regionData = computeLabelMap(repairedImageData);

             const updatedBundle: ProjectBundle = {
                 ...activeBundle,
                 layers: {
                     regions: regionData,
                     outlines: outlinesSvg
                 }
             };

             setActiveBundle(updatedBundle);
             setCurrentRegionColors({}); 
             setGenSettings(s => ({ ...s, thickness: newThickness }));
             setUiError(null);

          } catch (e) {
              console.error("Failed to update outlines", e);
              setUiError("Failed to update outlines.");
          } finally {
              setProcessingHints(false);
          }
      }, 50);
  };

  // --- Render ---

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
        timelapseLog={finalTimelapse}
        baseVectorUrl={activeBundle?.layers.outlines || ''} 
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
        {uiError && (
          <div className="mb-8 w-full max-w-2xl p-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl flex items-center gap-4 animate-bounce shadow-sm">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            <p className="font-medium">{uiError}</p>
          </div>
        )}

        {/* IDLE STATE */}
        {state === 'idle' && (
          <div className="flex flex-col items-center gap-8 md:gap-12 animate-in fade-in slide-in-from-bottom-8 duration-700 w-full">
            <div className="text-center max-w-2xl">
              <span className="px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-bold uppercase tracking-wider mb-6 inline-block">
                v4.8 - Outline Control
              </span>
              <h2 className="text-5xl md:text-6xl font-black text-gray-800 mb-6 leading-[1.1]">
                Turn Memories into <br/>
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600">
                  Vector Art
                </span>
              </h2>
              
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
                  <div className="text-gray-800 font-bold capitalize">{genSettings.style.replace('_', ' ')} <span className="text-gray-300 mx-1">•</span> {genSettings.thickness} Outline</div>
                </div>
                <i className="fa-solid fa-chevron-right text-gray-300 ml-2"></i>
              </button>
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

        {/* JOB RUNNING STATE (Pipeline Visualization) */}
        {state === 'job_running' && activeJob && (
          <div className="glass-panel flex flex-col gap-6 p-10 rounded-[2.5rem] shadow-2xl border-t border-white/80 w-full max-w-xl animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center">
              <h3 className="text-2xl font-black text-gray-800 mb-1">Processing Job</h3>
              <p className="text-gray-400 text-sm font-mono uppercase tracking-widest">ID: {activeJob.id.slice(0, 8)}</p>
            </div>

            <div className="space-y-4">
              {activeJob.steps.map((step, idx) => (
                <div key={step.id} className="flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    step.status === 'completed' ? 'bg-green-500 text-white' :
                    step.status === 'running' ? 'bg-blue-500 text-white animate-pulse' :
                    'bg-gray-100 text-gray-400'
                  }`}>
                    {step.status === 'completed' ? <i className="fa-solid fa-check"></i> : idx + 1}
                  </div>
                  <div className="flex-grow">
                    <div className="flex justify-between text-sm font-bold text-gray-700 mb-1">
                      <span>{step.label}</span>
                      {step.status === 'running' && <span className="text-blue-500">Processing...</span>}
                    </div>
                    {step.status === 'running' && (
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full animate-progress-indeterminate"></div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex justify-between text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                <span>Total Progress</span>
                <span>{activeJob.progress}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${activeJob.progress}%` }}
                ></div>
              </div>
            </div>
          </div>
        )}

        {/* EDITOR STATE */}
        {state === 'editor' && activeBundle && (
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
                        palette={activeBundle.palette}
                    />
                    {isEraser && (
                        <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] rounded-xl flex items-center justify-center cursor-not-allowed" onClick={() => setIsEraser(false)}>
                            <span className="bg-gray-800 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg cursor-pointer">
                                Tap to Exit Eraser
                            </span>
                        </div>
                    )}
                </div>
                
                {/* Active Tool Indicator */}
                <div className="mt-6 pt-6 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Active</span>
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-600">{isEraser ? 'Eraser' : activeBundle.palette.find(c => c.hex === selectedColor)?.name || selectedColor}</span>
                        <div 
                            className="w-10 h-10 rounded-full shadow-lg border-2 border-white"
                            style={{ backgroundColor: isEraser ? '#fff' : selectedColor }}
                        >
                            {isEraser && <div className="w-full h-full flex items-center justify-center text-red-500"><i className="fa-solid fa-slash"></i></div>}
                        </div>
                    </div>
                  </div>
                </div>

                {/* Outline Controls */}
                <div className="mt-6 pt-6 border-t border-gray-100">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 block">Outline Style</label>
                    
                    {/* Size Selector */}
                    <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
                        {(['thin', 'medium', 'thick', 'heavy'] as OutlineThickness[]).map(t => (
                            <button
                                key={t}
                                onClick={() => handleOutlineChange(t)}
                                className={`flex-1 py-2 rounded-lg text-[10px] md:text-xs font-bold capitalize transition-all ${
                                    genSettings.thickness === t 
                                    ? 'bg-white text-gray-800 shadow-sm' 
                                    : 'text-gray-400 hover:text-gray-600'
                                }`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    {/* Color Selector */}
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-gray-500">Color</span>
                        <div className="flex gap-2">
                           {['#000000', '#374151', '#4b2c20', '#1e3a8a', '#14532d'].map(c => (
                             <button
                               key={c}
                               onClick={() => setOutlineColor(c)}
                               className={`w-8 h-8 rounded-full border-2 transition-transform ${
                                 outlineColor === c ? 'scale-110 border-blue-500 shadow-md' : 'border-transparent hover:scale-105'
                               }`}
                               style={{ backgroundColor: c }}
                               title={c}
                             />
                           ))}
                        </div>
                    </div>
                </div>

                {user && (
                    <div className="mt-6 flex flex-col gap-2">
                       {currentProjectId && (
                          <div className="text-center text-xs font-semibold text-gray-400 mb-1 flex items-center justify-center gap-2">
                             <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Auto-save active
                          </div>
                       )}

                       <button 
                          onClick={async () => {
                              if (!user || !activeBundle) return;
                              alert(currentProjectId ? 'Project saved!' : 'Auto-saving...');
                          }}
                          className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-bold hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                      >
                          <i className="fa-solid fa-cloud-arrow-up"></i> Save
                      </button>
                    </div>
                )}
              </div>

              {processingHints ? (
                  <div className="bg-white p-6 rounded-[2rem] shadow-lg border border-gray-100 flex items-center gap-4 animate-pulse">
                      <div className="w-10 h-10 rounded-full border-4 border-blue-100 border-t-blue-500 animate-spin"></div>
                      <div>
                          <p className="font-bold text-gray-800">Updating Outlines...</p>
                      </div>
                  </div>
              ) : (
                  <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-6 rounded-[2rem] text-white shadow-xl shadow-indigo-500/20">
                    <h4 className="font-bold text-lg mb-2 flex items-center gap-2">
                    <i className="fa-solid fa-wand-magic-sparkles text-yellow-300"></i> Zen Mode Active
                    </h4>
                    <p className="text-sm opacity-90 leading-relaxed font-medium">
                    Showing hints only for the <b>selected color</b>. Pick a color to reveal its spots!
                    </p>
                </div>
              )}
            </div>

            {/* Main Canvas Area */}
            <div className="flex-grow w-full order-1 lg:order-2">
              <DrawingCanvas 
                key={activeBundle.manifest.id}
                regionData={activeBundle.layers.regions}
                outlinesUrl={activeBundle.layers.outlines}
                initialStateUrl={initialStateUrl}
                initialRegionColors={currentRegionColors}
                coloredIllustrationUrl={activeBundle.assets.coloredPreviewUrl}
                selectedColor={selectedColor}
                outlineColor={outlineColor} 
                isEraser={isEraser}
                onProcessingHints={setProcessingHints}
                onAutoSave={user ? handleAutoSave : undefined}
                onCompletion={handleCompletion}
                palette={activeBundle.palette}
                existingTimelapse={currentTimelapse}
                width={activeBundle.manifest.dimensions.width}
                height={activeBundle.manifest.dimensions.height}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
