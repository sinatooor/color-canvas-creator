// @ts-nocheck - Deno edge function runs in Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI } from "npm:@google/genai@^1.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageData, mimeType, style, complexity, mode } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const stylePrompts: Record<string, string> = {
      classic: "Paint by Numbers style. Clean, distinct organic shapes. Balanced composition.",
      stained_glass: "Stained Glass window style. Thick, geometric black leading lines. Jewel-tone flat colors. Angular segmentation.",
      mandala: "Mandala and Pattern style. Symmetrical, intricate, repetitive decorative elements integrated into the subject.",
      anime: "Anime/Manga Line Art style. Clean, thin, uniform lines. Focus on character outlines and minimal background noise. Cel-shaded look."
    };

    const complexityConfig: Record<string, { max: string; min: string }> = {
      low: { max: "5%", min: "1%" },
      medium: { max: "2%", min: "0.3%" },
      high: { max: "0.5%", min: "0.1%" }
    };

    let promptText: string;
    
    if (mode === 'line_art') {
      promptText = `Convert this colored illustration into a strict BLACK AND WHITE coloring page.

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

Output a clean, vector-style line art image suitable for a coloring book.`;
    } else {
      const selectedStyle = stylePrompts[style] || stylePrompts.classic;
      const selectedComplexity = complexityConfig[complexity] || complexityConfig.medium;

      promptText = `You are an expert technical illustrator creating a source image for a coloring app.

TASK: Convert this image into a "${style}" style illustration.

STYLE GUIDELINES:
${selectedStyle}

STRICT VISUAL REQUIREMENTS:
1. **Pre-Colored**: The output must be FULLY COLORED with flat, solid colors.
2. **Black Outlines**: Every single color region must be separated by a **THICK, BOLD, PURE BLACK (#000000)** stroke.
3. **Segmentation**:
   - **Max Region Size**: ${selectedComplexity.max} of canvas.
   - **Min Region Size**: ${selectedComplexity.min} of canvas.
4. **Color Palette**: Limit to 32 distinct colors. DO NOT USE DARK COLORS for fills.

NEGATIVE PROMPT (STRICTLY FORBIDDEN):
- NO shading, NO gradients, NO shadows.
- NO cross-hatching, NO stippling, NO dot textures.
- NO noise, NO sketchy lines.
- NO realistic photo details.
- NO grayscale.

The result should look like a professional vector coloring page template where the thick black lines are clearly distinguishable from the fill colors.`;
    }

    console.log(`Processing ${mode} request with style: ${style}, complexity: ${complexity}`);

    // Try with gemini-3-pro-image-preview first (best quality)
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: {
          parts: [
            { inlineData: { data: imageData, mimeType: mimeType } },
            { text: promptText + "\n\nResolution: 2K." }
          ],
        },
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { imageSize: "2K", aspectRatio: "1:1" }
        }
      });

      console.log("Gemini 3 Pro response received");

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          return new Response(JSON.stringify({ imageUrl }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } catch (err) {
      console.warn("Pro model failed, attempting fallback...", err);
    }

    // Fallback to gemini-2.5-flash-image
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { data: imageData, mimeType: mimeType } },
            { text: promptText }
          ],
        },
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "1:1" }
        }
      });

      console.log("Gemini 2.5 Flash response received");

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          return new Response(JSON.stringify({ imageUrl }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } catch (err: any) {
      console.error("Fallback model also failed:", err);
      throw new Error(err.message || "Failed to generate illustration.");
    }

    throw new Error("No illustration generated by the AI.");

  } catch (error) {
    console.error("Error in generate-illustration:", error);
    
    // Handle rate limiting
    const errorMessage = error instanceof Error ? error.message : "Failed to generate illustration";
    if (errorMessage.includes("429") || errorMessage.includes("quota") || errorMessage.includes("rate")) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
