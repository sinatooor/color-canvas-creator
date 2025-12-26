<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FifoColor.AI - Vector Coloring Studio

Transform any photo into a beautiful, leak-proof coloring page using AI-powered image processing.

## What This App Does

1. **Upload a Photo** - Take or upload any image (PNG/JPEG)
2. **AI Illustration Generation** - Gemini AI transforms your photo into a flat-colored, segmented illustration with pure black outlines
3. **Leak-Proof Processing** - Advanced CV algorithms seal gaps and create distinct regions:
   - Morphological operations (close/open) to fill small gaps
   - Endpoint bridging to connect nearby line segments
   - Color edge detection for additional boundaries
   - Leak validation and repair
4. **Instant Tap-to-Fill Coloring** - WebGL2-powered canvas with precomputed region IDs means:
   - Zero color leakage (fills never bleed into adjacent regions)
   - Instant fills (no flood-fill computation)
   - GPU-accelerated rendering
5. **Save & Share** - Auto-save progress, timelapse replay, and export finished artwork

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **AI**: Google Gemini 3 Pro (image generation)
- **Image Processing**: Web Worker with morphological operations
- **Rendering**: WebGL2 with region-based shaders
- **Backend**: Supabase (Lovable Cloud) for storage & auth

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Architecture

```
Upload PNG → GenAI (illustration) → CV (seal gaps) → Region Labeling → WebGL2 Editor
```

The key innovation is that coloring regions are computed once during preprocessing, stored as a label map, and rendered via GPU shaders - making runtime leakage impossible.
