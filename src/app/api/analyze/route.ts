import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import sharp from 'sharp';

const genAI = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY!});

function buildPromptWithUserInstructions(basePrompt: string, userPrompt?: string) {
  if (!userPrompt) return basePrompt;
  
  const userInstructionsSection = `

USER INSTRUCTIONS:
The user has provided the following custom instructions for organizing their files:
"${userPrompt}"

IMPORTANT: Follow the user's instructions as closely as possible while maintaining the JSON structure. If the user specifies custom grouping criteria, apply them in your analysis.`;

  return basePrompt + userInstructionsSection;
}

async function processFile(file: File): Promise<{buffer: Buffer, mimeType: string}> {
  const isHeic = file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic');
  
  if (isHeic) {
    try {
      const buffer = await file.arrayBuffer();
      const convertedBuffer = await sharp(Buffer.from(buffer))
        .jpeg({ quality: 80 })
        .toBuffer();
      
      return {
        buffer: convertedBuffer,
        mimeType: 'image/jpeg'
      };
    } catch (error) {
      console.error('HEIC conversion failed:', error);
      // Fallback to original file if conversion fails
      const buffer = await file.arrayBuffer();
      return {
        buffer: Buffer.from(buffer),
        mimeType: file.type
      };
    }
  }
  
  // For non-HEIC files, return as is
  const buffer = await file.arrayBuffer();
  return {
    buffer: Buffer.from(buffer),
    mimeType: file.type
  };
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
    
    // Process uploaded files with HEIC conversion support
    for (const file of files) {
      if (file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.heic')) {
        const { buffer, mimeType } = await processFile(file);
        const base64 = buffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64}`;
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

    // PHASE 1: Analyze all images to extract content and text
    const baseAnalysisPrompt = `You are analyzing an image to extract key information. Look carefully at all visible content, text, UI elements, and context clues.

Analyze this image and return ONLY a valid JSON object with this exact structure:

{
  "content": "brief content description using underscores (payslip_document, react_error, login_form, api_response, pdf_document, salary_statement, website_page, photo, diagram, etc.)",
  "extracted_text": "key visible text from the document content (up to 150 characters, focus on meaningful text not UI labels)",
  "main_theme": "single word describing the primary theme (finance, coding, design, personal, business, error, social, etc.)",
  "confidence": 85
}`;

    const initialAnalyses = await Promise.all(
      allItems.map(async (item, index) => {
        try {
          const enhancedPrompt = buildPromptWithUserInstructions(baseAnalysisPrompt, userPrompt);
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
                      mimeType: item.data.includes('data:image/jpeg') ? 'image/jpeg' : 'image/png'
                    }
                  }
                ],
                role: "user"
              }
            ]
          });
          
          const responseText = result.text?.trim() || '';
          const cleanResponseText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .replace(/^json\n?/g, '')
            .trim();
          
          let analysis;
          try {
            analysis = JSON.parse(cleanResponseText);
          } catch (parseError) {
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
                content: `image_document_${index + 1}`,
                extracted_text: "Could not extract text",
                main_theme: "misc",
                confidence: 20
              };
            }
          }
          
          return {
            index,
            content: String(analysis.content || `image_document_${index + 1}`).replace(/\s+/g, '_'),
            extracted_text: String(analysis.extracted_text || "").substring(0, 150),
            main_theme: String(analysis.main_theme || 'misc').toLowerCase(),
            confidence: Math.min(100, Math.max(0, Number(analysis.confidence) || 50)),
            fileName: item.name || `${item.type}_${index + 1}`
          };
          
        } catch (error) {
          console.error(`Error in initial analysis for image ${index}:`, error);
          return {
            index,
            content: `error_image_${index + 1}`,
            extracted_text: "Processing failed",
            main_theme: "misc",
            confidence: 0,
            fileName: item.name || `${item.type}_${index + 1}`
          };
        }
      })
    );

    // PHASE 2: Create smart categories based on all the analyzed content
    const categoryPrompt = `Based on the following image analysis results, create smart categories that group similar content together.

Image Analysis Results:
${initialAnalyses.map((analysis, i) => 
  `Image ${i + 1}: Content="${analysis.content}", Text="${analysis.extracted_text}", Theme="${analysis.main_theme}", File="${analysis.fileName}"`
).join('\n')}

${userPrompt ? `\nUser Instructions: "${userPrompt}"` : ''}

Create categories that make logical sense based on the actual content. Return ONLY a valid JSON object with this structure:

{
  "categories": {
    "category_name_1": {
      "description": "Brief description of what this category contains",
      "images": [0, 1, 3]
    },
    "category_name_2": {
      "description": "Brief description of what this category contains", 
      "images": [2, 4]
    }
  }
}

Guidelines:
- Use descriptive category names (e.g., "financial_documents", "code_errors", "ui_designs", "personal_photos")
- Each image index should appear in exactly one category
- Create 2-6 categories based on natural groupings
- Consider content type, theme, and extracted text for grouping`;

    let categorization;
    try {
      const categoryResult = await genAI.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [
          {
            parts: [{ text: categoryPrompt }],
            role: "user"
          }
        ]
      });
      
      const categoryResponseText = categoryResult.text?.trim() || '';
      const cleanCategoryResponse = categoryResponseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^json\n?/g, '')
        .trim();
      
      categorization = JSON.parse(cleanCategoryResponse);
    } catch (error) {
      console.error("Error creating categories:", error);
      // Fallback: create categories based on main themes
      const themes = [...new Set(initialAnalyses.map(a => a.main_theme))];
      categorization = {
        categories: themes.reduce((acc, theme, themeIndex) => {
          const imageIndices = initialAnalyses
            .map((a, i) => ({ theme: a.main_theme, index: i }))
            .filter(item => item.theme === theme)
            .map(item => item.index);
          
          acc[theme] = {
            description: `Images related to ${theme}`,
            images: imageIndices
          };
          return acc;
        }, {} as any)
      };
    }

    // PHASE 3: Build final results with categories
    const results = initialAnalyses.map((analysis, index) => {
      // Find which category this image belongs to
      const categoryEntry = Object.entries(categorization.categories || {})
        .find(([_, categoryInfo]: [string, any]) => 
          categoryInfo.images && categoryInfo.images.includes(index)
        );
      
      const categoryName = categoryEntry ? categoryEntry[0] : 'uncategorized';
      
      return {
        index: analysis.index,
        analysis: {
          content: analysis.content,
          category: categoryName,
          extracted_text: analysis.extracted_text,
          confidence: analysis.confidence
        },
        status: 'success',
        fileType: 'image',
        fileName: analysis.fileName
      };
    });
    
    return NextResponse.json({ 
      results,
      categories: categorization.categories || {},
      userPrompt: userPrompt || null
    });
    
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Internal server error" }, 
      { status: 500 }
    );
  }
}