'use client'

import { useState } from 'react'

interface AnalysisResult {
  index: number;
  analysis: {
    app: string;
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
  const [dragOver, setDragOver] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleFiles = (selectedFiles: FileList | File[]) => {
    const fileArray = Array.from(selectedFiles);
    const imageFiles = fileArray.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 10) {
      alert('Maximum 10 images allowed');
      return;
    }
    
    setFiles(imageFiles);
    setResults([]);
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
    if (files.length === 0) return;
    
    setProcessing(true);
    
    try {
      // Convert files to base64
      const imagePromises = files.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });
      
      const imageDataUrls = await Promise.all(imagePromises);
      
      // Send to API
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ images: imageDataUrls }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setResults(data.results);
      
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
    return `${analysis.app}_${analysis.content}_${date}.${extension}`;
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
            const folderPath = `${result.analysis.category}/${result.analysis.app}`;
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
      link.download = `organized_screenshots_${new Date().toISOString().split('T')[0]}.zip`;
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
    const categories = [...new Set(results.map(r => r.analysis.category))];
    const apps = [...new Set(results.map(r => r.analysis.app))];
    
    return `Screenshot Analysis Summary
Generated: ${timestamp}

Total Screenshots Analyzed: ${results.length}
Categories Found: ${categories.join(', ')}
Apps Detected: ${apps.join(', ')}

Detailed Results:
${results.map((result, index) => {
  const file = files[result.index];
  return `
${index + 1}. ${file?.name}
   Category: ${result.analysis.category}
   App: ${result.analysis.app}
   Content: ${result.analysis.content}
   Extracted Text: ${result.analysis.extracted_text || 'None'}
   Confidence: ${result.analysis.confidence}%
   New Name: ${generateFileName(file, result.analysis)}
`;
}).join('')}
`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800">
          📸 Screenshot Organizer
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
              Drop screenshots here or click to select
            </div>
            <div className="text-sm text-gray-500">
              Max 10 images • PNG, JPG, WebP supported
            </div>
            <button className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors">
              Choose Files
            </button>
          </div>
          
          <input
            id="fileInput"
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

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
                  <span className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
              ))}
            </div>
            
            <button
              onClick={processImages}
              disabled={processing}
              className="w-full mt-6 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? '🤖 Analyzing with AI...' : '🚀 Analyze Screenshots'}
            </button>
          </div>
        )}

        {/* Processing Spinner */}
        {processing && (
          <div className="bg-white rounded-xl p-8 text-center shadow-lg mb-8">
            <div className="animate-spin w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600">AI is analyzing your screenshots...</p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">
              📋 Analysis Results
            </h2>
            
            {results.map((result, index) => (
              <div key={index} className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-indigo-500">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-gray-800 mb-2">
                      📁 {result.analysis.category} / {result.analysis.app}
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
                      <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs">
                        {result.analysis.app}
                      </span>
                    </div>
                  </div>
                  
                  <div className="ml-4">
                    {files[result.index] && (
                      <img
                        src={URL.createObjectURL(files[result.index])}
                        alt="Preview"
                        className="w-20 h-20 object-cover rounded-lg"
                      />
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