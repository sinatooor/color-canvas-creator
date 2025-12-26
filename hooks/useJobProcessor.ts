
import { useState, useCallback } from 'react';
import { Job, GenerationSettings, ProjectBundle, OutlineThickness } from '../types';
import { transformToIllustration } from '../services/geminiService';
import { outlineService } from '../services/outlineService';
import { validateAndFixFrame, extractPalette } from '../utils/imageProcessing';
import { computeLabelMap } from '../utils/labeling';
import { DEFAULT_PALETTE } from '../constants';

export const useJobProcessor = () => {
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const updateJobStep = (job: Job, stepId: string, status: 'running' | 'completed', progress: number): Job => {
    const updatedSteps = job.steps.map(s => {
      if (s.id === stepId) return { ...s, status };
      if (status === 'running' && s.id !== stepId && s.status === 'running') return { ...s, status: 'completed' };
      return s;
    });
    
    return {
      ...job,
      status: 'running',
      currentStepId: stepId,
      progress: progress,
      steps: updatedSteps as any
    };
  };

  const startJob = useCallback(async (base64Image: string, settings: GenerationSettings, onSuccess: (bundle: ProjectBundle) => void) => {
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
      
      // Perform CV Fixes
      imageData = validateAndFixFrame(imageData);
      ctx.putImageData(imageData, 0, 0);
      const validatedIllustration = canvas.toDataURL('image/png');
      
      // Extract optimized palette
      const extractedPalette = extractPalette(imageData);
      
      job = updateJobStep(job, 'cv_validate', 'completed', 45);
      setActiveJob(job);

      // --- Step 3: Generate Outlines (First pass needed for Map) ---
      job = updateJobStep(job, 'generate_outlines', 'running', 50);
      setActiveJob(job);
      
      // Generate repaired data for logic map
      const repairedImageData = outlineService.processAndRepairImage(imageData, settings.thickness);
      
      // Generate Visual SVG
      const outlinesSvg = await outlineService.generateLeakProofOutlines(imageData, settings.thickness);

      job = updateJobStep(job, 'generate_outlines', 'completed', 75);
      setActiveJob(job);

      // --- Step 4: Build Region Map (Labeling) ---
      job = updateJobStep(job, 'build_region_map', 'running', 80);
      setActiveJob(job);

      const regionData = computeLabelMap(repairedImageData);
      
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

  const resetJob = useCallback(() => {
    setActiveJob(null);
    setError(null);
  }, []);

  return {
    activeJob,
    error,
    startJob,
    resetJob
  };
};
