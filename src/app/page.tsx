'use client'

import { useEffect, useState } from 'react'

interface AnalysisResult {
  index: number;
  analysis: {
    content: string;
    category: string;
    extracted_text: string;
    confidence: number;
  };
  status: string;
  error?: string;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [categories, setCategories] = useState<any>({});
  const [dragOver, setDragOver] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');

  const handleFiles = (selectedFiles: FileList | File[]) => {
    const fileArray = Array.from(selectedFiles);
    const allowedFiles = fileArray.filter(file => 
      file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.heic')
    );
    
    if (allowedFiles.length > 10) {
      alert('Maximum 10 files allowed');
      return;
    }
    
    setFiles(allowedFiles);
    setResults([]);
    setCategories({});
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const processImages = async () => {
    console.log('processing images')
    if (files.length === 0) return;
    
    setProcessing(true);
    
    try {
      // Use FormData instead of JSON to properly handle files
      const formData = new FormData();
      
      // Add all files to FormData
      files.forEach((file, index) => {
        formData.append('files', file);
      });
      
      // Add user prompt if provided
      if (userPrompt.trim()) {
        formData.append('userPrompt', userPrompt.trim());
      }
      
      console.log('Sending files via FormData');
      
      // Send to API with FormData (no Content-Type header needed - browser will set it)
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData, // Send FormData directly
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setResults(data.results);
      setCategories(data.categories || {});
      
    } catch (error) {
      console.error('Error processing images:', error);
      alert('Error processing images. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const generateFileName = (file: File, analysis: AnalysisResult['analysis']) => {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const extension = file.name.split('.').pop();
    return `${analysis.content}_${date}.${extension}`;
  };

  const downloadOrganizedZip = async () => {
    if (results.length === 0 || files.length === 0) return;
    
    setDownloading(true);
    
    try {
      // Dynamically import JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      // Create folders and add files
      for (const result of results) {
        if (result.status === 'success' && result.analysis) {
          const file = files[result.index];
          if (file) {
            const folderPath = `${result.analysis.category}`;
            const fileName = generateFileName(file, result.analysis);
            
            // Create folder structure
            const folder = zip.folder(folderPath);
            
            // Convert file to array buffer
            const fileBuffer = await file.arrayBuffer();
            
            // Add file to the folder
            folder?.file(fileName, fileBuffer);
          }
        }
      }
      
      // Add a summary report
      const summaryContent = generateSummaryReport();
      zip.file('analysis_summary.txt', summaryContent);
      
      // Generate ZIP file
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Create download link
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `organized_images_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Error creating ZIP:', error);
      alert('Error creating ZIP file. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const generateSummaryReport = () => {
    const timestamp = new Date().toISOString();
    const categoryNames = Object.keys(categories);
    return `Image Analysis Summary
Generated: ${timestamp}

Total Images Analyzed: ${results.length}
Categories Created: ${categoryNames.join(', ')}

Category Details:
${categoryNames.map(catName => {
  const categoryInfo = categories[catName];
  return `
${catName}:
  Description: ${categoryInfo.description}
  Images: ${categoryInfo.images.length} files
`;
}).join('')}

Detailed Results:
${results.map((result, index) => {
  const file = files[result.index];
  return `
${index + 1}. ${file?.name}
   Category: ${result.analysis.category}
   Content: ${result.analysis.content}
   Extracted Text: ${result.analysis.extracted_text || 'None'}
   Confidence: ${result.analysis.confidence}%
   New Name: ${generateFileName(file, result.analysis)}
`;
}).join('')}
`;
  };

  const ImagePreview = ({ file, index }: { file: File, index: number }) => {
    const [imageError, setImageError] = useState(false);
    const [imageUrl, setImageUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    
    // Check if file is HEIC
    const isHeic = file.type === 'image/heic' || 
                  file.name.toLowerCase().endsWith('.heic') ||
                  file.name.toLowerCase().endsWith('.heif');
    
    useEffect(() => {
      if (file.type === 'application/pdf') {
        setIsLoading(false);
        return;
      }
      
      // For HEIC files, we can't preview them directly
      if (isHeic) {
        setIsLoading(false);
        return;
      }
      
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      setIsLoading(false);
      
      return () => {
        URL.revokeObjectURL(url);
      };
    }, [file, isHeic]);
    
    if (file.type === 'application/pdf') {
      return (
        <div className="w-20 h-20 bg-red-100 rounded-lg flex items-center justify-center">
          <span className="text-red-600 text-2xl">📄</span>
        </div>
      );
    }
    
    // Special handling for HEIC files (can't be previewed directly)
    if (isHeic) {
      return (
        <div className="w-20 h-20 bg-orange-100 rounded-lg flex items-center justify-center">
          <div className="text-xs text-orange-700 text-center p-2">
            <div className="text-lg">📸</div>
            <div>HEIC</div>
          </div>
        </div>
      );
    }
    
    if (isLoading) {
      return (
        <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center">
          <div className="text-gray-400 text-lg">⏳</div>
        </div>
      );
    }
    
    if (imageError || !imageUrl) {
      return (
        <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center">
          <div className="text-xs text-gray-500 text-center p-2">
            <div className="text-lg">🖼️</div>
            <div>{file.name.split('.').pop()?.toUpperCase()}</div>
          </div>
        </div>
      );
    }
    
    return (
      <img
        src={imageUrl}
        alt="Preview"
        className="w-20 h-20 object-cover rounded-lg"
        onError={() => {
          console.error('Image failed to load:', imageUrl, file.type, file.name);
          setImageError(true);
        }}
        onLoad={() => {
          console.log('Image loaded successfully:', file.name);
        }}
      />
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800">
          📄 Document & Image Organizer
        </h1>
        
        {/* Upload Area */}
        <div
          className={`border-3 border-dashed rounded-xl p-12 text-center transition-all duration-300 mb-8 ${
            dragOver
              ? 'border-indigo-500 bg-indigo-50 scale-105'
              : 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-indigo-50'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => document.getElementById('fileInput')?.click()}
        >
          <div className="space-y-4">
            <div className="text-6xl">📁</div>
            <div className="text-xl text-gray-600">
              Drop files here or click to select
            </div>
            <div className="text-sm text-gray-500">
              Max 10 files • PNG, JPG, WebP, HEIC, PDF supported
            </div>
            <button className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors">
              Choose Files
            </button>
          </div>
          
          <input
            id="fileInput"
            type="file"
            multiple
            accept="image/*,application/pdf,.heic"
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {/* Custom Instructions */}
        <div className="bg-white rounded-xl p-6 mb-8 shadow-lg">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            📝 Custom Instructions (Optional)
          </h3>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="Add custom instructions for organizing your files. For example:
• Organize into: Work Documents, Personal Photos, Receipts
• Group by date or person
• Focus on specific content types
• Any other special requirements..."
            className="w-full h-32 p-4 border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm text-gray-700"
          />
          <p className="text-xs text-gray-500 mt-2">
            These instructions will guide how the AI analyzes and categorizes your files.
          </p>
        </div>

        {/* Categories Overview */}
        {Object.keys(categories).length > 0 && (
          <div className="bg-white rounded-xl p-6 mb-8 shadow-lg">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">
              🗂️ Smart Categories Created
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(categories).map(([categoryName, categoryInfo]: [string, any]) => (
                <div key={categoryName} className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
                  <h4 className="font-medium text-indigo-900 mb-2">{categoryName}</h4>
                  <p className="text-sm text-indigo-700 mb-2">{categoryInfo.description}</p>
                  <span className="text-xs text-indigo-600">
                    {categoryInfo.images?.length || 0} images
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selected Files */}
        {files.length > 0 && (
          <div className="bg-white rounded-xl p-6 mb-8 shadow-lg">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">
              Selected Files ({files.length}/10)
            </h3>
            <div className="space-y-2">
              {files.map((file, index) => (
                <div key={index} className="flex items-center justify-between py-2 px-4 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-700">{file.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    {file.name.toLowerCase().endsWith('.heic') && (
                      <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                        HEIC → JPEG
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <button
              onClick={processImages}
              disabled={processing}
              className="w-full mt-6 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? '🤖 Analyzing with AI...' : '🚀 Analyze Files'}
            </button>
          </div>
        )}

        {/* Processing Spinner */}
        {processing && (
          <div className="bg-white rounded-xl p-8 text-center shadow-lg mb-8">
            <div className="animate-spin w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600">AI is analyzing your files...</p>
            {userPrompt.trim() && (
              <p className="text-sm text-indigo-600 mt-2">
                🎯 Using your custom instructions
              </p>
            )}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                📋 Analysis Results
              </h2>
              {userPrompt.trim() && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1">
                  <span className="text-xs text-indigo-700">
                    🎯 Custom instructions applied
                  </span>
                </div>
              )}
            </div>
            
            {results.map((result, index) => (
              <div key={index} className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-indigo-500">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-gray-800 mb-2">
                      📁 {result.analysis.category}
                    </h3>
                    
                    <div className="space-y-2 text-sm text-gray-600">
                      <p><strong>Original:</strong> {files[result.index]?.name}</p>
                      <p><strong>Suggested:</strong> {generateFileName(files[result.index], result.analysis)}</p>
                      <p><strong>Content:</strong> {result.analysis.content}</p>
                      <p><strong>Extracted Text:</strong> {result.analysis.extracted_text || 'None'}</p>
                      <p><strong>Confidence:</strong> {result.analysis.confidence}%</p>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mt-3">
                      <span className="bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-xs">
                        {result.analysis.category}
                      </span>
                    </div>
                  </div>
                  
                  <div className="ml-4">
                    {files[result.index] && (
                      <ImagePreview file={files[result.index]} index={result.index} />
                    )}
                  </div>
                </div>
                
                {result.status === 'error' && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-600 text-sm">Error: {result.error}</p>
                  </div>
                )}
              </div>
            ))}
            
            <div className="text-center pt-6">
              <button 
                onClick={downloadOrganizedZip}
                disabled={downloading}
                className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 transition-colors text-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {downloading ? '📦 Creating ZIP...' : '📦 Download Organized ZIP'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}