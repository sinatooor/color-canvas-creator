
import { Color } from './types';

// ============================================
// MAGIC NUMBER CONSTANTS (Documented Thresholds)
// ============================================

/** 
 * Pixel threshold for classifying as "wall" (outline) in label map.
 * Pixels with all RGB channels below this value are treated as boundaries.
 */
export const WALL_THRESHOLD = 30;

/**
 * Minimum region size in pixels to show hints.
 * Regions smaller than this are considered noise/specks and are hidden.
 */
export const MIN_REGION_SIZE_FOR_HINTS = 100;

/**
 * Threshold for black outline detection in validation.
 * Pixels with all channels below this are forced to pure black.
 */
export const OUTLINE_DARKNESS_THRESHOLD = 40;

/**
 * Minimum luminance for fill colors (approx 30% of 255).
 * Dark fills below this are lightened to improve contrast.
 */
export const MIN_FILL_LUMINANCE = 76;

/**
 * Brightness boost applied to too-dark fill colors.
 */
export const DARK_FILL_BOOST = 60;

/**
 * Binarization threshold for image processing.
 * Pixels with max channel below this become black.
 */
export const BINARIZE_THRESHOLD = 20;

/**
 * Minimum neighbors for salt/pepper noise filter.
 * Pixels with fewer matching neighbors are flipped.
 */
export const NOISE_NEIGHBOR_THRESHOLD = 4;

/**
 * Sampling step for palette extraction (1/100th of image).
 * Higher value = faster extraction, lower accuracy.
 */
export const PALETTE_SAMPLE_STEP = 10;

/**
 * Target number of colors for K-means palette extraction.
 */
export const PALETTE_K_MEANS_K = 24;

/**
 * Maximum iterations for K-means convergence.
 */
export const PALETTE_K_MEANS_MAX_ITERATIONS = 10;

/**
 * Threshold for skipping black pixels in palette extraction.
 */
export const PALETTE_BLACK_THRESHOLD = 50;

/**
 * Threshold for skipping white pixels in palette extraction.
 */
export const PALETTE_WHITE_THRESHOLD = 245;

/**
 * Median filter threshold for binarization.
 * Increased to 200 to capture dark gray outlines from AI generation.
 */
export const MEDIAN_FILTER_THRESHOLD = 200;

/**
 * Minimum component size for despeckle operation.
 */
export const DESPECKLE_MIN_SIZE = 50;

// ============================================
// Application Constants
// ============================================

export const DEFAULT_PALETTE: Color[] = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Lime', hex: '#84cc16' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Fuchsia', hex: '#d946ef' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Gray', hex: '#94a3b8' },
  { name: 'Black', hex: '#000000' },
];

export const MAX_UNDO_STEPS = 20;
