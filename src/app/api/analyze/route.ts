import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY!});

export async function POST(request: NextRequest) {
  try {
    const { images } = await request.json();
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }
    
    if (images.length > 10) {
      return NextResponse.json({ error: "Maximum 10 images allowed" }, { status: 400 });
    }

    const analysisPrompt = `You are analyzing a screenshot. Look carefully at all visible content, text, UI elements, and context clues to understand what this image shows.

Analyze this screenshot and return ONLY a valid JSON object with this exact structure:

{
  "app": "detected app name (be specific: preview, adobe_acrobat, vscode, figma, chrome, safari, terminal, slack, notion, etc.)",
  "content": "brief content description using underscores (payslip_document, react_error, login_form, api_response, pdf_document, salary_statement, etc.)",
  "category": "choose from: code, design, social, documents, errors, finance, productivity, misc",
  "extracted_text": "key visible text from the document content (up to 150 characters, focus on meaningful text not UI labels)",
  "confidence": 85
}

CRITICAL INSTRUCTIONS:
- Look at the DOCUMENT CONTENT, not just the application window
- For PDF viewers like Preview, identify what type of document it is
- Extract meaningful text from the document itself (company names, amounts, dates, etc.)
- Be specific with app detection (Preview for Mac PDF viewer, Adobe Acrobat, etc.)
- If this appears to be a payslip/salary document, use content like "payslip_document" or "salary_statement"
- Focus on the actual content being displayed, not the app interface
- Return ONLY the JSON object with no additional text or formatting
- Confidence should reflect how certain you are about the analysis (1-100)`;

    const results = await Promise.all(
      images.map(async (imageData: string, index: number) => {
        try {
          // Remove data URL prefix if present
          const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
          
          // Use the correct API call format for @google/genai
          const result = await genAI.models.generateContent({
            model: "gemini-2.5-pro",
            contents: [
              {
                parts: [
                  { text: analysisPrompt },
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
          
          // Extract text from the response correctly
          const responseText = result.text?.trim() || '';
          
          // Clean the response text - remove any markdown formatting
          const cleanResponseText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .replace(/^json\n?/g, '')
            .trim();
          
          // Try to parse JSON response
          let analysis;
          try {
            analysis = JSON.parse(cleanResponseText);
          } catch (parseError) {
            console.error(`JSON parse error for image ${index}:`, parseError);
            console.error(`Raw response: "${responseText}"`);
            console.error(`Cleaned response: "${cleanResponseText}"`);
            
            // Try to extract JSON from the response if it's embedded in other text
            const jsonMatch = cleanResponseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                analysis = JSON.parse(jsonMatch[0]);
              } catch (secondParseError) {
                console.error(`Second JSON parse failed:`, secondParseError);
                analysis = null;
              }
            }
            
            if (!analysis) {
              // Create a more intelligent fallback based on common patterns
              analysis = {
                app: "unknown",
                content: `document_${index + 1}`,
                category: "documents",
                extracted_text: "Could not extract text",
                confidence: 20
              };
            }
          }
          
          // Validate and clean the response
          const cleanedAnalysis = {
            app: String(analysis.app || "unknown").toLowerCase().replace(/\s+/g, '_'),
            content: String(analysis.content || `document_${index + 1}`).replace(/\s+/g, '_'),
            category: String(analysis.category || "misc").toLowerCase(),
            extracted_text: String(analysis.extracted_text || "").substring(0, 150),
            confidence: Math.min(100, Math.max(0, Number(analysis.confidence) || 50))
          };
          
          return {
            index,
            analysis: cleanedAnalysis,
            status: 'success'
          };
          
        } catch (error) {
          console.error(`Error processing image ${index}:`, error);
          
          // Log the full error for debugging
          if (error instanceof Error) {
            console.error(`Error details: ${error.message}`);
            console.error(`Stack trace: ${error.stack}`);
          }
          
          return {
            index,
            analysis: {
              app: "unknown",
              content: `error_screenshot_${index + 1}`,
              category: "misc",
              extracted_text: "Processing failed",
              confidence: 0
            },
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );
    
    return NextResponse.json({ results });
    
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Internal server error" }, 
      { status: 500 }
    );
  }
}