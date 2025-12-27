
import React, { useState, useRef } from 'react';
import { useAdvancedSettings, DEFAULT_SETTINGS } from '../stores/advancedSettings';

interface SliderProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  defaultValue: number;
}

const Slider: React.FC<SliderProps> = ({ label, description, value, min, max, step = 1, onChange, defaultValue }) => (
  <div className="mb-4">
    <div className="flex justify-between items-center mb-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
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
}

const Section: React.FC<SectionProps> = ({ title, icon, children, defaultOpen = false }) => {
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
        </div>
        <i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-400`}></i>
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
};

const AdvancedPanel: React.FC = () => {
  const { 
    settings, 
    updateSetting, 
    resetToDefaults, 
    exportSettings, 
    importSettings,
    setIsAdvancedMode 
  } = useAdvancedSettings();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activePromptTab, setActivePromptTab] = useState<'styles' | 'complexity' | 'lineart'>('styles');

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

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <Section title="Outline Processing" icon="fa-pen-ruler" defaultOpen>
          <Slider
            label="Wall Threshold"
            description="Pixels darker than this become walls. Higher = more sensitive to gray lines."
            value={settings.wallThreshold}
            min={0}
            max={255}
            onChange={(v) => updateSetting('wallThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.wallThreshold}
          />
          <Slider
            label="Median Filter Threshold"
            description="Binarization threshold. Lower = less aggressive, preserves more detail."
            value={settings.medianFilterThreshold}
            min={0}
            max={255}
            onChange={(v) => updateSetting('medianFilterThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.medianFilterThreshold}
          />
          <Slider
            label="Despeckle Min Size"
            description="Minimum component size in pixels. Lower = keeps more small outline fragments."
            value={settings.despeckleMinSize}
            min={1}
            max={500}
            onChange={(v) => updateSetting('despeckleMinSize', v)}
            defaultValue={DEFAULT_SETTINGS.despeckleMinSize}
          />
          <Slider
            label="Gap Closing Radius"
            description="Morphological close radius for filling small gaps."
            value={settings.gapClosingRadius}
            min={0}
            max={5}
            onChange={(v) => updateSetting('gapClosingRadius', v)}
            defaultValue={DEFAULT_SETTINGS.gapClosingRadius}
          />
        </Section>

        <Section title="Region Detection" icon="fa-vector-square">
          <Slider
            label="Min Region Size for Hints"
            description="Regions smaller than this won't show number hints."
            value={settings.minRegionSizeForHints}
            min={1}
            max={1000}
            onChange={(v) => updateSetting('minRegionSizeForHints', v)}
            defaultValue={DEFAULT_SETTINGS.minRegionSizeForHints}
          />
          <Slider
            label="Noise Neighbor Threshold"
            description="Pixels with fewer matching neighbors are flipped (noise removal)."
            value={settings.noiseNeighborThreshold}
            min={1}
            max={8}
            onChange={(v) => updateSetting('noiseNeighborThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.noiseNeighborThreshold}
          />
        </Section>

        <Section title="Palette Extraction" icon="fa-palette">
          <Slider
            label="Sample Step"
            description="Sampling interval. Higher = faster, lower accuracy."
            value={settings.paletteSampleStep}
            min={1}
            max={50}
            onChange={(v) => updateSetting('paletteSampleStep', v)}
            defaultValue={DEFAULT_SETTINGS.paletteSampleStep}
          />
          <Slider
            label="K-Means K"
            description="Number of colors to extract."
            value={settings.paletteKMeansK}
            min={2}
            max={48}
            onChange={(v) => updateSetting('paletteKMeansK', v)}
            defaultValue={DEFAULT_SETTINGS.paletteKMeansK}
          />
          <Slider
            label="K-Means Max Iterations"
            description="Convergence iterations for K-means."
            value={settings.paletteKMeansMaxIterations}
            min={1}
            max={50}
            onChange={(v) => updateSetting('paletteKMeansMaxIterations', v)}
            defaultValue={DEFAULT_SETTINGS.paletteKMeansMaxIterations}
          />
          <Slider
            label="Black Threshold"
            description="Skip pixels darker than this in palette extraction."
            value={settings.paletteBlackThreshold}
            min={0}
            max={100}
            onChange={(v) => updateSetting('paletteBlackThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.paletteBlackThreshold}
          />
          <Slider
            label="White Threshold"
            description="Skip pixels brighter than this in palette extraction."
            value={settings.paletteWhiteThreshold}
            min={200}
            max={255}
            onChange={(v) => updateSetting('paletteWhiteThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.paletteWhiteThreshold}
          />
        </Section>

        <Section title="Color Processing" icon="fa-fill-drip">
          <Slider
            label="Min Fill Luminance"
            description="Dark fills below this are lightened."
            value={settings.minFillLuminance}
            min={0}
            max={255}
            onChange={(v) => updateSetting('minFillLuminance', v)}
            defaultValue={DEFAULT_SETTINGS.minFillLuminance}
          />
          <Slider
            label="Dark Fill Boost"
            description="Brightness boost for too-dark fills."
            value={settings.darkFillBoost}
            min={0}
            max={100}
            onChange={(v) => updateSetting('darkFillBoost', v)}
            defaultValue={DEFAULT_SETTINGS.darkFillBoost}
          />
          <Slider
            label="Gray Outline Threshold"
            description="Luminance below this is treated as outline (forced to black)."
            value={settings.grayOutlineThreshold}
            min={0}
            max={200}
            onChange={(v) => updateSetting('grayOutlineThreshold', v)}
            defaultValue={DEFAULT_SETTINGS.grayOutlineThreshold}
          />
        </Section>

        <Section title="AI Prompts" icon="fa-robot">
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
        <div className="flex gap-2">
          <button
            onClick={resetToDefaults}
            className="flex-1 py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
          >
            <i className="fa-solid fa-rotate-left mr-2"></i>
            Reset All
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
        <p className="text-xs text-gray-500 mt-3 text-center">
          ⚠️ Changes affect processing. Some require re-generating the image.
        </p>
      </div>
    </div>
  );
};

export default AdvancedPanel;
