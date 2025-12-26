// @ts-nocheck - Deno edge function runs in Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    let prompt: string;
    
    if (mode === 'line_art') {
      prompt = `Convert this colored illustration into a strict BLACK AND WHITE coloring page.

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

      prompt = `You are an expert technical illustrator creating a source image for a coloring app.

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

    // Use Google Gemini API directly with user's API key
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageData
                  }
                },
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
          }
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 403) {
        return new Response(JSON.stringify({ error: "Invalid API key or quota exceeded." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    console.log("Gemini response received successfully");

    // Extract the generated image from the Gemini response
    const parts = data.candidates?.[0]?.content?.parts;
    let imageBase64: string | null = null;
    let imageMimeType = "image/png";

    if (parts) {
      for (const part of parts) {
        if (part.inline_data) {
          imageBase64 = part.inline_data.data;
          imageMimeType = part.inline_data.mime_type || "image/png";
          break;
        }
      }
    }
    
    if (!imageBase64) {
      console.error("No image in response:", JSON.stringify(data));
      throw new Error("No image generated by Gemini");
    }

    // Return as data URL
    const imageUrl = `data:${imageMimeType};base64,${imageBase64}`;

    return new Response(JSON.stringify({ imageUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in generate-illustration:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to generate illustration" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
