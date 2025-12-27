
import React, { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

// All configurable parameters with their default values
export interface AdvancedSettings {
  // === Outline Processing ===
  wallThreshold: number;           // 0-255, pixels darker than this are walls
  medianFilterThreshold: number;   // 0-255, threshold for binarization
  despeckleMinSize: number;        // min connected component size to keep
  gapClosingRadius: number;        // morphological close radius (0-5)
  edgeBorderWidth: number;         // width of border added to edges to prevent leakage (0-10)
  
  // === SVG Vectorization ===
  svgLineSmoothness: number;       // 0-2, line tolerance (lower = more detail)
  svgCurveSmoothness: number;      // 0-2, curve tolerance (lower = more accurate curves)
  svgPathOmit: number;             // 0-100, omit paths smaller than this (0 = keep all)
  svgRoundCoords: number;          // 0-3, decimal places for coordinates (higher = more precision)
  
  // === Region Detection ===
  minRegionSizeForHints: number;   // min region size to show hints
  noiseNeighborThreshold: number;  // neighbors needed to not be "noise"
  
  // === Palette Extraction ===
  paletteSampleStep: number;       // sampling step (higher = faster, less accurate)
  paletteKMeansK: number;          // number of colors to extract
  paletteKMeansMaxIterations: number;
  paletteBlackThreshold: number;   // skip pixels darker than this
  paletteWhiteThreshold: number;   // skip pixels brighter than this
  
  // === Color Processing ===
  minFillLuminance: number;        // min luminance for fills
  darkFillBoost: number;           // boost applied to dark fills
  grayOutlineThreshold: number;    // threshold for detecting gray outlines
  
  // === Prompts ===
  promptStyleClassic: string;
  promptStyleStainedGlass: string;
  promptStyleMandala: string;
  promptStyleAnime: string;
  promptComplexityLow: { max: string; min: string };
  promptComplexityMedium: { max: string; min: string };
  promptComplexityHigh: { max: string; min: string };
  promptLineArt: string;
}

export const DEFAULT_SETTINGS: AdvancedSettings = {
  // Outline Processing
  wallThreshold: 128,
  medianFilterThreshold: 128,
  despeckleMinSize: 15,
  gapClosingRadius: 1,
  edgeBorderWidth: 2,
  
  // SVG Vectorization
  svgLineSmoothness: 0.5,
  svgCurveSmoothness: 0.5,
  svgPathOmit: 0,
  svgRoundCoords: 1,
  
  // Region Detection
  minRegionSizeForHints: 100,
  noiseNeighborThreshold: 4,
  
  // Palette Extraction
  paletteSampleStep: 10,
  paletteKMeansK: 24,
  paletteKMeansMaxIterations: 10,
  paletteBlackThreshold: 50,
  paletteWhiteThreshold: 245,
  
  // Color Processing
  minFillLuminance: 76,
  darkFillBoost: 60,
  grayOutlineThreshold: 120,
  
  // Prompts
  promptStyleClassic: "Paint by Numbers style. Clean, distinct organic shapes. Balanced composition.",
  promptStyleStainedGlass: "Stained Glass window style. Thick, geometric black leading lines. Jewel-tone flat colors. Angular segmentation.",
  promptStyleMandala: "Mandala and Pattern style. Symmetrical, intricate, repetitive decorative elements integrated into the subject.",
  promptStyleAnime: "Anime/Manga Line Art style. Clean, thin, uniform lines. Focus on character outlines and minimal background noise. Cel-shaded look.",
  promptComplexityLow: { max: "5%", min: "1%" },
  promptComplexityMedium: { max: "2%", min: "0.3%" },
  promptComplexityHigh: { max: "0.5%", min: "0.1%" },
  promptLineArt: `Convert this colored illustration into a strict BLACK AND WHITE coloring page.

REQUIREMENTS:
1. **Remove ALL Color**: The result must be purely Black lines on a White background.
2. **Line Quality**: Lines must be SOLID and UNIFORM thickness.
3. **Clean Up**: Remove any stray pixels, noise, or compression artifacts.

NEGATIVE PROMPT (CRITICAL):
- **NO GRAYSCALE**: Pixels must be strictly #000000 or #FFFFFF.
- **NO SHADING**: Remove all shadow rendering.
- **NO HATCHING**: Do not use texture to represent shade.
- **NO STIPPLING**: Do not use dots.
- **NO DITHERING**.

Output a clean, vector-style line art image suitable for a coloring book.`
};

// Categories for regeneration requirements
export type SettingCategory = 'api' | 'reprocess' | 'palette' | 'live';

export const SETTING_CATEGORIES: Record<keyof AdvancedSettings, SettingCategory> = {
  // API - requires full Gemini API call
  promptStyleClassic: 'api',
  promptStyleStainedGlass: 'api',
  promptStyleMandala: 'api',
  promptStyleAnime: 'api',
  promptComplexityLow: 'api',
  promptComplexityMedium: 'api',
  promptComplexityHigh: 'api',
  promptLineArt: 'api',
  
  // Reprocess - requires outline/region recomputation
  wallThreshold: 'reprocess',
  medianFilterThreshold: 'reprocess',
  despeckleMinSize: 'reprocess',
  gapClosingRadius: 'reprocess',
  edgeBorderWidth: 'reprocess',
  grayOutlineThreshold: 'reprocess',
  minFillLuminance: 'reprocess',
  darkFillBoost: 'reprocess',
  noiseNeighborThreshold: 'reprocess',
  
  // SVG Vectorization - requires reprocess
  svgLineSmoothness: 'reprocess',
  svgCurveSmoothness: 'reprocess',
  svgPathOmit: 'reprocess',
  svgRoundCoords: 'reprocess',
  
  // Palette - only re-extract palette
  paletteSampleStep: 'palette',
  paletteKMeansK: 'palette',
  paletteKMeansMaxIterations: 'palette',
  paletteBlackThreshold: 'palette',
  paletteWhiteThreshold: 'palette',
  
  // Live - display-only, instant
  minRegionSizeForHints: 'live',
};

interface AdvancedSettingsContextType {
  settings: AdvancedSettings;
  updateSetting: <K extends keyof AdvancedSettings>(key: K, value: AdvancedSettings[K]) => void;
  resetToDefaults: () => void;
  exportSettings: () => string;
  importSettings: (json: string) => boolean;
  isAdvancedMode: boolean;
  setIsAdvancedMode: (v: boolean) => void;
  changedSettings: Set<keyof AdvancedSettings>;
  clearChangedSettings: () => void;
  getRequiredRegenLevel: () => SettingCategory | null;
}

const AdvancedSettingsContext = createContext<AdvancedSettingsContextType | null>(null);

export const AdvancedSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS);
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const changedSettingsRef = useRef<Set<keyof AdvancedSettings>>(new Set());

  const updateSetting = useCallback(<K extends keyof AdvancedSettings>(key: K, value: AdvancedSettings[K]) => {
    setSettings(prev => {
      if (prev[key] !== value) {
        changedSettingsRef.current.add(key);
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    changedSettingsRef.current.clear();
  }, []);

  const exportSettings = useCallback(() => {
    return JSON.stringify(settings, null, 2);
  }, [settings]);

  const importSettings = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      changedSettingsRef.current.clear();
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearChangedSettings = useCallback(() => {
    changedSettingsRef.current.clear();
  }, []);

  // Determine highest priority regeneration level needed
  const getRequiredRegenLevel = useCallback((): SettingCategory | null => {
    const changed = changedSettingsRef.current;
    if (changed.size === 0) return null;
    
    // Priority: api > reprocess > palette > live
    for (const key of changed) {
      if (SETTING_CATEGORIES[key] === 'api') return 'api';
    }
    for (const key of changed) {
      if (SETTING_CATEGORIES[key] === 'reprocess') return 'reprocess';
    }
    for (const key of changed) {
      if (SETTING_CATEGORIES[key] === 'palette') return 'palette';
    }
    return 'live';
  }, []);

  return (
    <AdvancedSettingsContext.Provider value={{
      settings,
      updateSetting,
      resetToDefaults,
      exportSettings,
      importSettings,
      isAdvancedMode,
      setIsAdvancedMode,
      changedSettings: changedSettingsRef.current,
      clearChangedSettings,
      getRequiredRegenLevel
    }}>
      {children}
    </AdvancedSettingsContext.Provider>
  );
};

export const useAdvancedSettings = () => {
  const ctx = useContext(AdvancedSettingsContext);
  if (!ctx) throw new Error("useAdvancedSettings must be used within AdvancedSettingsProvider");
  return ctx;
};
