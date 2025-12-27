
import { useState, useCallback, useRef } from 'react';
import { Job, GenerationSettings, ProjectBundle, OutlineThickness, Color } from '../types';
import { transformToIllustration } from '../services/geminiService';
import { outlineService } from '../services/outlineService';
import { validateAndFixFrame, extractPalette, ImageProcessingSettings } from '../utils/imageProcessing';
import { computeLabelMap } from '../utils/labeling';
import { DEFAULT_PALETTE } from '../constants';
import { AdvancedSettings, SettingCategory } from '../stores/advancedSettings';

// Cached intermediate results for smart reprocessing
interface ProcessingCache {
  coloredIllustration: string;
  validatedImageData: ImageData;
  width: number;
  height: number;
}

export const useJobProcessor = () => {
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const cacheRef = useRef<ProcessingCache | null>(null);

  const createJob = (id: string): Job => ({
    id,
    status: 'queued',
    progress: 0,
    currentStepId: 'queued',
    steps: [
      { id: 'genai_stylize', label: 'AI Stylization & Coloring', status: 'pending' },
      { id: 'cv_validate', label: 'CV Check (Dark Fills & Outlines)', status: 'pending' },
      { id: 'build_region_map', label: 'Building Region Map', status: 'pending' },
      { id: 'generate_outlines', label: 'Generating Leak-Proof Outlines', status: 'pending' }, 
      { id: 'package_bundle', label: 'Creating Project Bundle', status: 'pending' }
    ]
  });

  // Direct processing job (skips AI step)
  const createDirectJob = (id: string): Job => ({
    id,
    status: 'queued',
    progress: 0,
    currentStepId: 'queued',
    steps: [
      { id: 'cv_validate', label: 'Processing B&W Image', status: 'pending' },
      { id: 'build_region_map', label: 'Building Region Map', status: 'pending' },
      { id: 'generate_outlines', label: 'Generating Outlines', status: 'pending' },
      { id: 'package_bundle', label: 'Creating Project Bundle', status: 'pending' }
    ]
  });

  const updateJobStep = (job: Job, stepId: string, status: 'running' | 'completed', progress: number): Job => {
    const updatedSteps = job.steps.map((s): typeof s => {
      if (s.id === stepId) return { ...s, status };
      if (status === 'running' && s.id !== stepId && s.status === 'running') return { ...s, status: 'completed' as const };
      return s;
    });
    
    return {
      ...job,
      status: 'running',
      currentStepId: stepId,
      progress: progress,
      steps: updatedSteps
    };
  };

  const startJob = useCallback(async (
    base64Image: string, 
    settings: GenerationSettings, 
    onSuccess: (bundle: ProjectBundle) => void,
    advancedSettings?: AdvancedSettings
  ) => {
    const jobId = crypto.randomUUID();
    let job = createJob(jobId);
    setActiveJob(job);
    setError(null);

    try {
      // --- Step 1: GenAI Stylize ---
      job = updateJobStep(job, 'genai_stylize', 'running', 10);
      setActiveJob(job);
      
      const coloredIllustration = await transformToIllustration(base64Image, settings.style, settings.complexity);
      
      job = updateJobStep(job, 'genai_stylize', 'completed', 30);
      setActiveJob(job);

      // --- Step 2: CV Validate & Auto Fix ---
      job = updateJobStep(job, 'cv_validate', 'running', 35);
      setActiveJob(job);
      
      const img = new Image();
      img.src = coloredIllustration;
      await new Promise((resolve) => { img.onload = resolve; });
      const width = img.width;
      const height = img.height;
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas context init failed");
      ctx.drawImage(img, 0, 0);
      
      let imageData = ctx.getImageData(0, 0, width, height);
      
      // Build processing settings from advanced settings
      const processingSettings: ImageProcessingSettings | undefined = advancedSettings ? {
        grayOutlineThreshold: advancedSettings.grayOutlineThreshold,
        minFillLuminance: advancedSettings.minFillLuminance,
        darkFillBoost: advancedSettings.darkFillBoost,
        noiseNeighborThreshold: advancedSettings.noiseNeighborThreshold,
        paletteSampleStep: advancedSettings.paletteSampleStep,
        paletteKMeansK: advancedSettings.paletteKMeansK,
        paletteKMeansMaxIterations: advancedSettings.paletteKMeansMaxIterations,
        paletteBlackThreshold: advancedSettings.paletteBlackThreshold,
        paletteWhiteThreshold: advancedSettings.paletteWhiteThreshold,
      } : undefined;
      
      // Perform CV Fixes
      imageData = validateAndFixFrame(imageData, processingSettings);
      ctx.putImageData(imageData, 0, 0);
      const validatedIllustration = canvas.toDataURL('image/png');
      
      // Cache for reprocessing
      cacheRef.current = {
        coloredIllustration,
        validatedImageData: ctx.getImageData(0, 0, width, height),
        width,
        height
      };
      
      // Extract optimized palette
      const extractedPalette = extractPalette(imageData, processingSettings);
      
      job = updateJobStep(job, 'cv_validate', 'completed', 45);
      setActiveJob(job);

      // --- Step 3: Generate Outlines (First pass needed for Map) ---
      job = updateJobStep(job, 'generate_outlines', 'running', 50);
      setActiveJob(job);
      
      // Build outline settings (including SVG vectorization)
      const outlineSettings = advancedSettings ? {
        medianFilterThreshold: advancedSettings.medianFilterThreshold,
        despeckleMinSize: advancedSettings.despeckleMinSize,
        gapClosingRadius: advancedSettings.gapClosingRadius,
        edgeBorderWidth: advancedSettings.edgeBorderWidth,
        svgLineSmoothness: advancedSettings.svgLineSmoothness,
        svgCurveSmoothness: advancedSettings.svgCurveSmoothness,
        svgPathOmit: advancedSettings.svgPathOmit,
        svgRoundCoords: advancedSettings.svgRoundCoords,
      } : undefined;
      
      // Generate repaired data for logic map
      const repairedImageData = outlineService.processAndRepairImage(imageData, settings.thickness, outlineSettings);
      
      // Generate Visual SVG
      const outlinesSvg = await outlineService.generateLeakProofOutlines(imageData, settings.thickness, outlineSettings);

      job = updateJobStep(job, 'generate_outlines', 'completed', 75);
      setActiveJob(job);

      // --- Step 4: Build Region Map (Labeling) ---
      job = updateJobStep(job, 'build_region_map', 'running', 80);
      setActiveJob(job);

      const labelingSettings = advancedSettings ? {
        wallThreshold: advancedSettings.wallThreshold,
        minRegionSizeForHints: advancedSettings.minRegionSizeForHints
      } : undefined;

      const regionData = computeLabelMap(repairedImageData, labelingSettings);
      
      job = updateJobStep(job, 'build_region_map', 'completed', 90);
      setActiveJob(job);

      // --- Step 5: Package Bundle ---
      job = updateJobStep(job, 'package_bundle', 'running', 95);
      setActiveJob(job);

      const bundle: ProjectBundle = {
        manifest: {
          id: jobId,
          name: `Artwork ${new Date().toLocaleString()}`,
          created_at: Date.now(),
          dimensions: { width, height }
        },
        layers: {
          regions: regionData,
          outlines: outlinesSvg
        },
        assets: {
          originalUrl: base64Image,
          coloredPreviewUrl: validatedIllustration
        },
        palette: extractedPalette.length > 0 ? extractedPalette : DEFAULT_PALETTE
      };

      job = updateJobStep(job, 'package_bundle', 'completed', 100);
      setActiveJob({ ...job, status: 'succeeded', result: bundle });
      
      // Success Callback
      onSuccess(bundle);

    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Job failed.';
      setActiveJob(prev => prev ? ({ ...prev, status: 'failed', error: msg }) : null);
      setError(msg);
    }
  }, []);

  // Smart reprocessing based on what changed
  const reprocessFromStep = useCallback(async (
    level: SettingCategory,
    currentBundle: ProjectBundle,
    settings: GenerationSettings,
    advancedSettings: AdvancedSettings,
    onSuccess: (bundle: ProjectBundle) => void
  ) => {
    if (!cacheRef.current) {
      setError("No cached data available. Please regenerate the image.");
      return;
    }

    setIsReprocessing(true);
    setError(null);

    try {
      const { coloredIllustration, width, height } = cacheRef.current;
      
      // Recreate imageData from cached illustration
      const img = new Image();
      img.src = coloredIllustration;
      await new Promise((resolve) => { img.onload = resolve; });
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas context init failed");
      ctx.drawImage(img, 0, 0);
      
      let imageData = ctx.getImageData(0, 0, width, height);
      
      const processingSettings: ImageProcessingSettings = {
        grayOutlineThreshold: advancedSettings.grayOutlineThreshold,
        minFillLuminance: advancedSettings.minFillLuminance,
        darkFillBoost: advancedSettings.darkFillBoost,
        noiseNeighborThreshold: advancedSettings.noiseNeighborThreshold,
        paletteSampleStep: advancedSettings.paletteSampleStep,
        paletteKMeansK: advancedSettings.paletteKMeansK,
        paletteKMeansMaxIterations: advancedSettings.paletteKMeansMaxIterations,
        paletteBlackThreshold: advancedSettings.paletteBlackThreshold,
        paletteWhiteThreshold: advancedSettings.paletteWhiteThreshold,
      };

      let newPalette: Color[] = currentBundle.palette;
      let newOutlinesSvg = currentBundle.layers.outlines;
      let newRegionData = currentBundle.layers.regions;
      let validatedIllustration = currentBundle.assets.coloredPreviewUrl;

      // Level: palette - only re-extract palette
      if (level === 'palette' || level === 'reprocess') {
        newPalette = extractPalette(imageData, processingSettings);
        if (newPalette.length === 0) newPalette = DEFAULT_PALETTE;
      }

      // Level: reprocess - re-run CV validation, outlines, region map
      if (level === 'reprocess') {
        // CV validation
        imageData = validateAndFixFrame(imageData, processingSettings);
        ctx.putImageData(imageData, 0, 0);
        validatedIllustration = canvas.toDataURL('image/png');
        
        // Update cache
        cacheRef.current.validatedImageData = ctx.getImageData(0, 0, width, height);

        const outlineSettings = {
          medianFilterThreshold: advancedSettings.medianFilterThreshold,
          despeckleMinSize: advancedSettings.despeckleMinSize,
          gapClosingRadius: advancedSettings.gapClosingRadius,
          edgeBorderWidth: advancedSettings.edgeBorderWidth,
          svgLineSmoothness: advancedSettings.svgLineSmoothness,
          svgCurveSmoothness: advancedSettings.svgCurveSmoothness,
          svgPathOmit: advancedSettings.svgPathOmit,
          svgRoundCoords: advancedSettings.svgRoundCoords,
        };

        // Regenerate outlines
        const repairedImageData = outlineService.processAndRepairImage(imageData, settings.thickness, outlineSettings);
        newOutlinesSvg = await outlineService.generateLeakProofOutlines(imageData, settings.thickness, outlineSettings);

        // Rebuild region map
        const labelingSettings = {
          wallThreshold: advancedSettings.wallThreshold,
          minRegionSizeForHints: advancedSettings.minRegionSizeForHints
        };
        newRegionData = computeLabelMap(repairedImageData, labelingSettings);
      }

      // Build updated bundle
      const updatedBundle: ProjectBundle = {
        ...currentBundle,
        layers: {
          regions: newRegionData,
          outlines: newOutlinesSvg
        },
        assets: {
          ...currentBundle.assets,
          coloredPreviewUrl: validatedIllustration
        },
        palette: newPalette
      };

      onSuccess(updatedBundle);

    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Reprocessing failed.';
      setError(msg);
    } finally {
      setIsReprocessing(false);
    }
  }, []);

  // Direct processing for B&W outlines (skips AI)
  const startDirectProcessingJob = useCallback(async (
    base64Image: string,
    thickness: OutlineThickness,
    onSuccess: (bundle: ProjectBundle) => void,
    advancedSettings?: AdvancedSettings
  ) => {
    const jobId = crypto.randomUUID();
    let job = createDirectJob(jobId);
    setActiveJob(job);
    setError(null);

    try {
      // --- Step 1: CV Validate & Clean B&W Image ---
      job = updateJobStep(job, 'cv_validate', 'running', 10);
      setActiveJob(job);
      
      const img = new Image();
      img.src = base64Image;
      await new Promise((resolve) => { img.onload = resolve; });
      const width = img.width;
      const height = img.height;
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas context init failed");
      ctx.drawImage(img, 0, 0);
      
      let imageData = ctx.getImageData(0, 0, width, height);
      
      // Build processing settings from advanced settings
      const processingSettings: ImageProcessingSettings | undefined = advancedSettings ? {
        grayOutlineThreshold: advancedSettings.grayOutlineThreshold,
        minFillLuminance: advancedSettings.minFillLuminance,
        darkFillBoost: advancedSettings.darkFillBoost,
        noiseNeighborThreshold: advancedSettings.noiseNeighborThreshold,
        paletteSampleStep: advancedSettings.paletteSampleStep,
        paletteKMeansK: advancedSettings.paletteKMeansK,
        paletteKMeansMaxIterations: advancedSettings.paletteKMeansMaxIterations,
        paletteBlackThreshold: advancedSettings.paletteBlackThreshold,
        paletteWhiteThreshold: advancedSettings.paletteWhiteThreshold,
      } : undefined;
      
      // Perform CV Fixes
      imageData = validateAndFixFrame(imageData, processingSettings);
      ctx.putImageData(imageData, 0, 0);
      const validatedIllustration = canvas.toDataURL('image/png');
      
      // Cache for reprocessing
      cacheRef.current = {
        coloredIllustration: base64Image,
        validatedImageData: ctx.getImageData(0, 0, width, height),
        width,
        height
      };
      
      job = updateJobStep(job, 'cv_validate', 'completed', 30);
      setActiveJob(job);

      // --- Step 2: Generate Outlines ---
      job = updateJobStep(job, 'generate_outlines', 'running', 40);
      setActiveJob(job);
      
      // Build outline settings (including SVG vectorization)
      const outlineSettings = advancedSettings ? {
        medianFilterThreshold: advancedSettings.medianFilterThreshold,
        despeckleMinSize: advancedSettings.despeckleMinSize,
        gapClosingRadius: advancedSettings.gapClosingRadius,
        edgeBorderWidth: advancedSettings.edgeBorderWidth,
        svgLineSmoothness: advancedSettings.svgLineSmoothness,
        svgCurveSmoothness: advancedSettings.svgCurveSmoothness,
        svgPathOmit: advancedSettings.svgPathOmit,
        svgRoundCoords: advancedSettings.svgRoundCoords,
      } : undefined;
      
      // Generate repaired data for logic map
      const repairedImageData = outlineService.processAndRepairImage(imageData, thickness, outlineSettings);
      
      // Generate Visual SVG
      const outlinesSvg = await outlineService.generateLeakProofOutlines(imageData, thickness, outlineSettings);

      job = updateJobStep(job, 'generate_outlines', 'completed', 60);
      setActiveJob(job);

      // --- Step 3: Build Region Map ---
      job = updateJobStep(job, 'build_region_map', 'running', 70);
      setActiveJob(job);

      const labelingSettings = advancedSettings ? {
        wallThreshold: advancedSettings.wallThreshold,
        minRegionSizeForHints: advancedSettings.minRegionSizeForHints
      } : undefined;

      const regionData = computeLabelMap(repairedImageData, labelingSettings);
      
      job = updateJobStep(job, 'build_region_map', 'completed', 85);
      setActiveJob(job);

      // --- Step 4: Package Bundle (use default palette) ---
      job = updateJobStep(job, 'package_bundle', 'running', 90);
      setActiveJob(job);

      const bundle: ProjectBundle = {
        manifest: {
          id: jobId,
          name: `Imported Outline ${new Date().toLocaleString()}`,
          created_at: Date.now(),
          dimensions: { width, height }
        },
        layers: {
          regions: regionData,
          outlines: outlinesSvg
        },
        assets: {
          originalUrl: base64Image,
          coloredPreviewUrl: validatedIllustration
        },
        palette: DEFAULT_PALETTE // Use default rainbow palette
      };

      job = updateJobStep(job, 'package_bundle', 'completed', 100);
      setActiveJob({ ...job, status: 'succeeded', result: bundle });
      
      // Success Callback
      onSuccess(bundle);

    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Direct processing failed.';
      setActiveJob(prev => prev ? ({ ...prev, status: 'failed', error: msg }) : null);
      setError(msg);
    }
  }, []);

  const resetJob = useCallback(() => {
    setActiveJob(null);
    setError(null);
    cacheRef.current = null;
  }, []);

  return {
    activeJob,
    error,
    isReprocessing,
    startJob,
    startDirectProcessingJob,
    reprocessFromStep,
    resetJob
  };
};
