
export type AppState = 'idle' | 'processing' | 'coloring';

export interface Color {
  name: string;
  hex: string;
}

export interface DrawingAction {
  imageData: ImageData;
}

export interface Hint {
  x: number;
  y: number;
  number: number;
  colorHex: string;
}

// Global Potrace definition
export interface PotraceLib {
  loadImageFromUrl: (url: string) => void;
  process: (callback: () => void) => void;
  getSVG: (size: number) => string;
  setParameter: (params: { 
    turdsize?: number; 
    alphamax?: number;
    optcurve?: boolean;
    opttolerance?: number;
    blacklevel?: number;
  }) => void;
  img: HTMLImageElement;
}

// --- New Types for Account & Settings ---

export type ArtStyle = 'classic' | 'stained_glass' | 'mandala' | 'anime';
export type ComplexityLevel = 'low' | 'medium' | 'high';

export interface GenerationSettings {
  style: ArtStyle;
  complexity: ComplexityLevel;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface TimelapseFrame {
  x: number;
  y: number;
  color: string;
}

export interface SavedProject {
  id: string;
  userId: string;
  name: string;
  thumbnailUrl: string; // The colored version (preview)
  vectorUrl: string;    // The SVG/Line art to color
  currentStateUrl?: string; // The active canvas state (lines + colors) for resuming
  originalUrl: string;  // The original photo
  palette: Color[];
  timelapseLog?: TimelapseFrame[]; // New: Stores the sequence of moves
  isFinished?: boolean; // New: Tracks completion status
  createdAt: number;
  updatedAt?: number;
}
