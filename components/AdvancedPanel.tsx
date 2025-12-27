
import React, { useState, useRef } from 'react';
import { useAdvancedSettings, DEFAULT_SETTINGS, SETTING_CATEGORIES, SettingCategory } from '../stores/advancedSettings';

// Category badge component
const CategoryBadge: React.FC<{ category: SettingCategory }> = ({ category }) => {
  const config = {
    api: { icon: '🔴', label: 'API', color: 'bg-red-100 text-red-700' },
    reprocess: { icon: '🟠', label: 'Reprocess', color: 'bg-orange-100 text-orange-700' },
    palette: { icon: '🟢', label: 'Palette', color: 'bg-green-100 text-green-700' },
    live: { icon: '🔵', label: 'Live', color: 'bg-blue-100 text-blue-700' }
  };
  const c = config[category];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${c.color}`}>
      {c.icon} {c.label}
    </span>
  );
};

interface SliderProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  defaultValue: number;
  category: SettingCategory;
}

const Slider: React.FC<SliderProps> = ({ label, description, value, min, max, step = 1, onChange, defaultValue, category }) => (
  <div className="mb-4">
    <div className="flex justify-between items-center mb-1">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <CategoryBadge category={category} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">{value}</span>
        {value !== defaultValue && (
          <button 
            onClick={() => onChange(defaultValue)} 
            className="text-xs text-blue-500 hover:text-blue-700"
            title="Reset to default"
          >
            ↺
          </button>
        )}
      </div>
    </div>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-indigo-600"
    />
    <div className="flex justify-between text-xs text-gray-400">
      <span>{min}</span>
      <span>{max}</span>
    </div>
  </div>
);

interface SectionProps {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, icon, children, defaultOpen = false, badge }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border-b border-gray-200 last:border-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <i className={`fa-solid ${icon} text-indigo-500`}></i>
          <span className="font-semibold text-gray-800">{title}</span>
          {badge}
        </div>
        <i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-400`}></i>
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
};

interface AdvancedPanelProps {
  onReprocess?: () => void;
  isReprocessing?: boolean;
  onDirectImport?: (base64: string) => void;
  isProcessingDirect?: boolean;
}

const AdvancedPanel: React.FC<AdvancedPanelProps> = ({ 
  onReprocess, 
  isReprocessing = false,
  onDirectImport,
  isProcessingDirect = false
}) => {
  const { 
    settings, 
    updateSetting, 
    resetToDefaults, 
    exportSettings, 
    importSettings,
    setIsAdvancedMode,
    getRequiredRegenLevel,
    clearChangedSettings
  } = useAdvancedSettings();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directImportRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activePromptTab, setActivePromptTab] = useState<'styles' | 'complexity' | 'lineart'>('styles');
  const [showDirectCamera, setShowDirectCamera] = useState(false);

  const regenLevel = getRequiredRegenLevel();

  const handleExport = () => {
    const json = exportSettings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fifocolor-advanced-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const json = ev.target?.result as string;
      if (importSettings(json)) {
        alert('Settings imported successfully!');
      } else {
        alert('Failed to import settings. Invalid JSON.');
      }
    };
    reader.readAsText(file);
  };

  // Handle direct B&W import
  const handleDirectImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onDirectImport) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      onDirectImport(base64);
      setIsAdvancedMode(false);
    };
    reader.readAsDataURL(file);
  };

  // Camera for direct import
  const startDirectCamera = async () => {
    setShowDirectCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      alert("Unable to access camera. Please check permissions.");
      setShowDirectCamera(false);
    }
  };

  const captureDirectPhoto = () => {
    if (!videoRef.current || !onDirectImport) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const base64 = canvas.toDataURL('image/png');
    
    // Stop camera
    const stream = videoRef.current.srcObject as MediaStream;
    stream?.getTracks().forEach(track => track.stop());
    setShowDirectCamera(false);
    
    onDirectImport(base64);
    setIsAdvancedMode(false);
  };

  const stopDirectCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
    }
    setShowDirectCamera(false);
  };

  const handleApply = () => {
    if (onReprocess) {
      onReprocess();
      clearChangedSettings();
    }
  };

  const getApplyButtonText = () => {
    if (isReprocessing) return 'Processing...';
    if (!regenLevel) return 'No Changes';
    switch (regenLevel) {
      case 'api': return '🔴 Regenerate (API)';
      case 'reprocess': return '🟠 Apply & Reprocess';
      case 'palette': return '🟢 Re-extract Palette';
      case 'live': return '🔵 Apply (Instant)';
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-indigo-500 to-purple-600">
        <div className="flex items-center gap-3">
          <i className="fa-solid fa-flask text-white text-xl"></i>
          <div>
            <h2 className="text-white font-bold text-lg">Advanced Mode</h2>
            <p className="text-white/70 text-xs">Debug & Experiment</p>
          </div>
        </div>
        <button
          onClick={() => setIsAdvancedMode(false)}
          className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
        >
          <i className="fa-solid fa-times"></i>
        </button>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-2 text-[10px]">
        <span className="text-gray-500 font-medium">Regen Level:</span>
        <CategoryBadge category="api" />
        <CategoryBadge category="reprocess" />
        <CategoryBadge category="palette" />
        <CategoryBadge category="live" />
      </div>

      {/* Direct Camera Modal */}
      {showDirectCamera && (
        <div className="absolute inset-0 bg-black z-50 flex flex-col">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="flex-1 object-cover"
          />
          <div className="absolute bottom-0 left-0 right-0 p-6 flex justify-center gap-4">
            <button
              onClick={stopDirectCamera}
              className="w-14 h-14 bg-white/20 hover:bg-white/30 text-white rounded-full flex items-center justify-center"
            >
              <i className="fa-solid fa-times text-xl"></i>
            </button>
            <button
              onClick={captureDirectPhoto}
              className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg"
            >
              <div className="w-16 h-16 bg-gray-200 rounded-full"></div>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Import B&W Outline Section */}
        <Section title="Import B&W Outline" icon="fa-camera" defaultOpen badge={<span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">Skip AI</span>}>
          <p className="text-xs text-gray-500 mb-3">
            Skip AI generation — import an existing black & white outline from a physical coloring book.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => directImportRef.current?.click()}
              disabled={isProcessingDirect}
              className="flex-1 py-3 px-3 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <i className="fa-solid fa-upload"></i> Upload
            </button>
            <button
              onClick={startDirectCamera}
              disabled={isProcessingDirect}
              className="flex-1 py-3 px-3 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <i className="fa-solid fa-camera"></i> Camera
            </button>
          </div>
          <input
            ref={directImportRef}
            type="file"
            accept="image/*"
            onChange={handleDirectImportFile}
            className="hidden"
          />
          <p className="text-[10px] text-gray-400 mt-2 text-center">
            Works best with clean, high-contrast black outlines on white background.
          </p>
        </Section>

        <Section title="Outline Processing" icon="fa-pen-ruler" badge={<CategoryBadge category="reprocess" />}>
          <Slider
            label="Wall Threshold"
            description="Pixels darker than this become walls. Higher = more sensitive to gray lines."
            value={settings.wallThreshold}
            min={0}
            max={255}
            onChange={(v) => updateSetting('wallThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.wallThreshold}
            category={SETTING_CATEGORIES.wallThreshold}
          />
          <Slider
            label="Median Filter Threshold"
            description="Binarization threshold. Lower = less aggressive, preserves more detail."
            value={settings.medianFilterThreshold}
            min={0}
            max={255}
            onChange={(v) => updateSetting('medianFilterThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.medianFilterThreshold}
            category={SETTING_CATEGORIES.medianFilterThreshold}
          />
          <Slider
            label="Despeckle Min Size"
            description="Minimum component size in pixels. Lower = keeps more small outline fragments."
            value={settings.despeckleMinSize}
            min={1}
            max={500}
            onChange={(v) => updateSetting('despeckleMinSize', v)}
            defaultValue={DEFAULT_SETTINGS.despeckleMinSize}
            category={SETTING_CATEGORIES.despeckleMinSize}
          />
          <Slider
            label="Gap Closing Radius"
            description="Morphological close radius for filling small gaps."
            value={settings.gapClosingRadius}
            min={0}
            max={5}
            onChange={(v) => updateSetting('gapClosingRadius', v)}
            defaultValue={DEFAULT_SETTINGS.gapClosingRadius}
            category={SETTING_CATEGORIES.gapClosingRadius}
          />
          <Slider
            label="Edge Border Width"
            description="Adds a border around image edges to prevent leakage where lines don't reach the edge."
            value={settings.edgeBorderWidth}
            min={0}
            max={10}
            onChange={(v) => updateSetting('edgeBorderWidth', v)}
            defaultValue={DEFAULT_SETTINGS.edgeBorderWidth}
            category={SETTING_CATEGORIES.edgeBorderWidth}
          />
          <Slider
            label="Gray Outline Threshold"
            description="Luminance below this is forced to pure black."
            value={settings.grayOutlineThreshold}
            min={0}
            max={200}
            onChange={(v) => updateSetting('grayOutlineThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.grayOutlineThreshold}
            category={SETTING_CATEGORIES.grayOutlineThreshold}
          />
        </Section>

        <Section title="Region Detection" icon="fa-vector-square" badge={<CategoryBadge category="live" />}>
          <Slider
            label="Min Region Size for Hints"
            description="Regions smaller than this won't show number hints."
            value={settings.minRegionSizeForHints}
            min={1}
            max={1000}
            onChange={(v) => updateSetting('minRegionSizeForHints', v)}
            defaultValue={DEFAULT_SETTINGS.minRegionSizeForHints}
            category={SETTING_CATEGORIES.minRegionSizeForHints}
          />
          <Slider
            label="Noise Neighbor Threshold"
            description="Pixels with fewer matching neighbors are flipped (noise removal)."
            value={settings.noiseNeighborThreshold}
            min={1}
            max={8}
            onChange={(v) => updateSetting('noiseNeighborThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.noiseNeighborThreshold}
            category={SETTING_CATEGORIES.noiseNeighborThreshold}
          />
        </Section>

        <Section title="Palette Extraction" icon="fa-palette" badge={<CategoryBadge category="palette" />}>
          <Slider
            label="Sample Step"
            description="Sampling interval. Higher = faster, lower accuracy."
            value={settings.paletteSampleStep}
            min={1}
            max={50}
            onChange={(v) => updateSetting('paletteSampleStep', v)}
            defaultValue={DEFAULT_SETTINGS.paletteSampleStep}
            category={SETTING_CATEGORIES.paletteSampleStep}
          />
          <Slider
            label="K-Means K"
            description="Number of colors to extract."
            value={settings.paletteKMeansK}
            min={2}
            max={48}
            onChange={(v) => updateSetting('paletteKMeansK', v)}
            defaultValue={DEFAULT_SETTINGS.paletteKMeansK}
            category={SETTING_CATEGORIES.paletteKMeansK}
          />
          <Slider
            label="K-Means Max Iterations"
            description="Convergence iterations for K-means."
            value={settings.paletteKMeansMaxIterations}
            min={1}
            max={50}
            onChange={(v) => updateSetting('paletteKMeansMaxIterations', v)}
            defaultValue={DEFAULT_SETTINGS.paletteKMeansMaxIterations}
            category={SETTING_CATEGORIES.paletteKMeansMaxIterations}
          />
          <Slider
            label="Black Threshold"
            description="Skip pixels darker than this in palette extraction."
            value={settings.paletteBlackThreshold}
            min={0}
            max={100}
            onChange={(v) => updateSetting('paletteBlackThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.paletteBlackThreshold}
            category={SETTING_CATEGORIES.paletteBlackThreshold}
          />
          <Slider
            label="White Threshold"
            description="Skip pixels brighter than this in palette extraction."
            value={settings.paletteWhiteThreshold}
            min={200}
            max={255}
            onChange={(v) => updateSetting('paletteWhiteThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.paletteWhiteThreshold}
            category={SETTING_CATEGORIES.paletteWhiteThreshold}
          />
        </Section>

        <Section title="Color Processing" icon="fa-fill-drip" badge={<CategoryBadge category="reprocess" />}>
          <Slider
            label="Min Fill Luminance"
            description="Dark fills below this are lightened."
            value={settings.minFillLuminance}
            min={0}
            max={255}
            onChange={(v) => updateSetting('minFillLuminance', v)}
            defaultValue={DEFAULT_SETTINGS.minFillLuminance}
            category={SETTING_CATEGORIES.minFillLuminance}
          />
          <Slider
            label="Dark Fill Boost"
            description="Brightness boost for too-dark fills."
            value={settings.darkFillBoost}
            min={0}
            max={100}
            onChange={(v) => updateSetting('darkFillBoost', v)}
            defaultValue={DEFAULT_SETTINGS.darkFillBoost}
            category={SETTING_CATEGORIES.darkFillBoost}
          />
        </Section>

        <Section title="AI Prompts" icon="fa-robot" badge={<CategoryBadge category="api" />}>
          <div className="flex gap-1 mb-4">
            {(['styles', 'complexity', 'lineart'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActivePromptTab(tab)}
                className={`flex-1 py-1.5 px-2 text-xs font-bold rounded transition-colors ${
                  activePromptTab === tab 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {activePromptTab === 'styles' && (
            <div className="space-y-4">
              {(['Classic', 'StainedGlass', 'Mandala', 'Anime'] as const).map((style) => {
                const key = `promptStyle${style}` as keyof typeof settings;
                return (
                  <div key={style}>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">{style}</label>
                    <textarea
                      value={settings[key] as string}
                      onChange={(e) => updateSetting(key, e.target.value)}
                      className="w-full h-24 text-xs border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {activePromptTab === 'complexity' && (
            <div className="space-y-4">
              {(['Low', 'Medium', 'High'] as const).map((level) => {
                const key = `promptComplexity${level}` as 'promptComplexityLow' | 'promptComplexityMedium' | 'promptComplexityHigh';
                const val = settings[key];
                return (
                  <div key={level} className="bg-gray-50 p-3 rounded-lg">
                    <label className="text-sm font-medium text-gray-700 mb-2 block">{level} Complexity</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">Max Region %</label>
                        <input
                          type="text"
                          value={val.max}
                          onChange={(e) => updateSetting(key, { ...val, max: e.target.value })}
                          className="w-full text-sm border border-gray-300 rounded p-1.5"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Min Region %</label>
                        <input
                          type="text"
                          value={val.min}
                          onChange={(e) => updateSetting(key, { ...val, min: e.target.value })}
                          className="w-full text-sm border border-gray-300 rounded p-1.5"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activePromptTab === 'lineart' && (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Line Art Prompt</label>
              <textarea
                value={settings.promptLineArt}
                onChange={(e) => updateSetting('promptLineArt', e.target.value)}
                className="w-full h-48 text-xs border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
              />
            </div>
          )}
        </Section>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        {/* Apply Button - Primary action */}
        <button
          onClick={handleApply}
          disabled={isReprocessing || !regenLevel}
          className={`w-full py-3 px-4 rounded-xl font-bold transition-all mb-3 flex items-center justify-center gap-2 ${
            isReprocessing
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : !regenLevel
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : regenLevel === 'api'
              ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg'
              : regenLevel === 'reprocess'
              ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg'
              : regenLevel === 'palette'
              ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
              : 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg'
          }`}
        >
          {isReprocessing && <i className="fa-solid fa-spinner fa-spin"></i>}
          {getApplyButtonText()}
        </button>

        <div className="flex gap-2">
          <button
            onClick={resetToDefaults}
            className="flex-1 py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
          >
            <i className="fa-solid fa-rotate-left mr-2"></i>
            Reset
          </button>
          <button
            onClick={handleExport}
            className="flex-1 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
          >
            <i className="fa-solid fa-download mr-2"></i>
            Export
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            <i className="fa-solid fa-upload mr-2"></i>
            Import
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
      </div>
    </div>
  );
};

export default AdvancedPanel;