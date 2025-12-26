
export type AppState = 'idle' | 'job_running' | 'editor';

export interface Color {
  name: string;
  hex: string;
}

export interface Hint {
  x: number;
  y: number;
  number: number;
  colorHex: string;
}

// --- Architecture: Job Pipeline ---
export interface JobStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface Job {
  id: string;
  status: 'queued' | 'running' | 'failed' | 'succeeded';
  progress: number;
  currentStepId: string;
  steps: JobStep[];
  error?: string;
  result?: ProjectBundle;
}

// --- Architecture: Label Map Data ---
// RLE Run for fast rendering: [y, xStart, xEnd]
export type ScanlineRun = [number, number, number];

export interface RegionData {
  width: number;
  height: number;
  // We store the label map as a flat array for serialization
  labelMap: number[]; 
  maxRegionId: number;
}

// --- Architecture: Project Bundle ---
export interface ProjectBundle {
  manifest: {
    id: string;
    name: string;
    created_at: number;
    dimensions: { width: number; height: number };
  };
  layers: {
    // Fills are now handled by the label map engine, not SVG
    regions: RegionData; 
    outlines: string; // SVG Content for Line Art Overlay
  };
  assets: {
    originalUrl: string;
    coloredPreviewUrl: string;
  };
  palette: Color[];
}

export interface TimelapseFrame {
  x: number; // For replay animation (visual only)
  y: number;
  regionId: number; // Changed from pathIndex to regionId
  color: string;
}

export interface SavedProject {
  id: string;
  userId: string;
  name: string;
  thumbnailUrl: string;
  bundle: ProjectBundle; 
  currentStateUrl?: string; 
  timelapseLog?: TimelapseFrame[];
  // We need to save the filled state of regions
  regionColors?: Record<number, string>;
  isFinished?: boolean;
  createdAt: number;
  updatedAt?: number;
}

// User & Settings
export type ArtStyle = 'classic' | 'stained_glass' | 'mandala' | 'anime';
export type ComplexityLevel = 'low' | 'medium' | 'high';
export type OutlineThickness = 'thin' | 'medium' | 'thick' | 'heavy';

export interface GenerationSettings {
  style: ArtStyle;
  complexity: ComplexityLevel;
  thickness: OutlineThickness;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}
