import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY!});

function buildPromptWithUserInstructions(basePrompt: string, userPrompt?: string) {
  if (!userPrompt) return basePrompt;
  
  const userInstructionsSection = `

USER INSTRUCTIONS:
The user has provided the following custom instructions for organizing their files:
"${userPrompt}"

IMPORTANT: Follow the user's instructions as closely as possible while maintaining the JSON structure. If the user specifies custom categories, use those instead of the default ones. If the user mentions specific grouping criteria, apply them in your analysis.`;

  return basePrompt + userInstructionsSection;
}

export async function POST(request: NextRequest) {
  try {
    // Try to parse as FormData first (for file uploads)
    let files: File[] = [];
    let imageDataUrls: string[] = [];
    let userPrompt: string | undefined;
    
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      files = Array.from(formData.getAll('files') as File[]);
      imageDataUrls = Array.from(formData.getAll('images') as string[]);
      userPrompt = formData.get('userPrompt') as string | null || undefined;
    } else {
      // Fallback to JSON for backward compatibility (images only)
      const body = await request.json();
      imageDataUrls = body.images || [];
      userPrompt = body.userPrompt;
    }
    
    const allItems: Array<{type: 'image', data: string, name?: string}> = [];
    
    // Process uploaded files
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const buffer = await file.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const dataUrl = `data:${file.type};base64,${base64}`;
        allItems.push({
          type: 'image',
          data: dataUrl,
          name: file.name
        });
      }
    }
    
    // Add image URLs from JSON payload
    imageDataUrls.forEach(imageData => {
      allItems.push({
        type: 'image',
        data: imageData
      });
    });
    
    if (allItems.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }
    
    if (allItems.length > 10) {
      return NextResponse.json({ error: "Maximum 10 images allowed" }, { status: 400 });
    }

    const baseImagePrompt = `You are analyzing an image. Look carefully at all visible content, text, UI elements, and context clues to understand what this image shows.

Analyze this image and return ONLY a valid JSON object with this exact structure:

{
  "app": "detected app name (be specific: preview, adobe_acrobat, vscode, figma, chrome, safari, terminal, slack, notion, etc.)",
  "content": "brief content description using underscores (payslip_document, react_error, login_form, api_response, pdf_document, salary_statement, website_page, photo, diagram, etc.)",
  "category": "choose from: code, design, social, documents, errors, finance, productivity, misc",
  "extracted_text": "key visible text from the document content (up to 150 characters, focus on meaningful text not UI labels)",
  "confidence": 85
}`;

    const results = await Promise.all(
      allItems.map(async (item, index) => {
        try {
          // Analyze image
          const enhancedPrompt = buildPromptWithUserInstructions(baseImagePrompt, userPrompt);
          const base64Data = item.data.replace(/^data:image\/[a-z]+;base64,/, '');
          
          const result = await genAI.models.generateContent({
            model: "gemini-2.5-pro",
            contents: [
              {
                parts: [
                  { text: enhancedPrompt },
                  {
                    inlineData: {
                      data: base64Data,
                      mimeType: "image/png"
                    }
                  }
                ],
                role: "user"
              }
            ]
          });
          
          const responseText = result.text?.trim() || '';
          
          // Clean the response text
          const cleanResponseText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .replace(/^json\n?/g, '')
            .trim();
          
          let analysis;
          try {
            analysis = JSON.parse(cleanResponseText);
          } catch (parseError) {
            console.error(`JSON parse error for item ${index}:`, parseError);
            console.error(`Raw response: "${responseText}"`);
            
            // Try to extract JSON from the response
            const jsonMatch = cleanResponseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                analysis = JSON.parse(jsonMatch[0]);
              } catch (secondParseError) {
                analysis = null;
              }
            }
            
            if (!analysis) {
              analysis = {
                app: 'unknown',
                content: `image_document_${index + 1}`,
                category: 'misc',
                extracted_text: "Could not extract text",
                confidence: 20
              };
            }
          }
          
          // Clean and validate the response
          const cleanedAnalysis = {
            app: String(analysis.app || 'unknown').toLowerCase().replace(/\s+/g, '_'),
            content: String(analysis.content || `image_document_${index + 1}`).replace(/\s+/g, '_'),
            category: String(analysis.category || 'misc').toLowerCase(),
            extracted_text: String(analysis.extracted_text || "").substring(0, 150),
            confidence: Math.min(100, Math.max(0, Number(analysis.confidence) || 50))
          };
          
          return {
            index,
            analysis: cleanedAnalysis,
            status: 'success',
            fileType: item.type,
            fileName: item.name || `${item.type}_${index + 1}`
          };
          
        } catch (error) {
          console.error(`Error processing image ${index}:`, error);
          
          return {
            index,
            analysis: {
              app: 'unknown',
              content: `error_image_${index + 1}`,
              category: 'misc',
              extracted_text: "Processing failed",
              confidence: 0
            },
            status: 'error',
            fileType: item.type,
            fileName: item.name || `${item.type}_${index + 1}`,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );
    
    return NextResponse.json({ 
      results,
      userPrompt: userPrompt || null // Include the user prompt in response for reference
    });
    
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Internal server error" }, 
      { status: 500 }
    );
  }
}