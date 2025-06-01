import React, { useState, useEffect, useMemo } from 'react';

function App() {
    const [receipts, setReceipts] = useState([]);
    const [loading, setLoading] = useState(false); // For file processing
    const [scriptsLoaded, setScriptsLoaded] = useState(false); // For external JS libraries
    const [error, setError] = useState(null);
    // State to track which file's preview is currently shown
    const [currentPreviewIndex, setCurrentPreviewIndex] = useState(-1);
    // State to track which cell is being edited: { rowIndex: number, fieldName: string }
    const [editingCell, setEditingCell] = useState(null);
    const [editedValue, setEditedValue] = useState('');

    // Dynamically load pdf.js, jszip, and file-saver libraries
    useEffect(() => {
        let pdfJsScript, jszipScript, fileSaverScript;
        const scriptsToLoad = [
            { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js', id: 'pdfjs-script' },
            { src: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', id: 'jszip-script' },
            { src: 'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js', id: 'filesaver-script' }
        ];
        let loadedCount = 0;

        const scriptLoaded = () => {
            loadedCount++;
            if (loadedCount === scriptsToLoad.length) {
                // Ensure pdf.js worker is set after pdf.js is loaded
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                }
                setScriptsLoaded(true);
            }
        };

        scriptsToLoad.forEach(scriptInfo => {
            const script = document.createElement('script');
            script.src = scriptInfo.src;
            script.id = scriptInfo.id;
            script.onload = scriptLoaded;
            script.onerror = () => {
                console.error(`Failed to load script: ${scriptInfo.src}`);
                setError(`Failed to load a required library: ${scriptInfo.src}. Please check your internet connection.`);
                // Still mark as loaded to potentially allow partial functionality or prevent infinite loading
                scriptLoaded();
            };
            document.body.appendChild(script);

            // Store references for cleanup
            if (scriptInfo.id === 'pdfjs-script') pdfJsScript = script;
            if (scriptInfo.id === 'jszip-script') jszipScript = script;
            if (scriptInfo.id === 'filesaver-script') fileSaverScript = script;
        });


        return () => {
            // Clean up scripts when component unmounts
            if (pdfJsScript && document.body.contains(pdfJsScript)) document.body.removeChild(pdfJsScript);
            if (jszipScript && document.body.contains(jszipScript)) document.body.removeChild(jszipScript);
            if (fileSaverScript && document.body.contains(fileSaverScript)) document.body.removeChild(fileSaverScript);
        };
    }, []);

    // Memoized current image preview based on currentPreviewIndex
    const currentImagePreview = useMemo(() => {
        if (currentPreviewIndex >= 0 && currentPreviewIndex < receipts.length) {
            const receipt = receipts[currentPreviewIndex];
            // For preview, we always use the image data generated for Gemini, as original PDFs can't be directly displayed as <img>
            if (receipt && receipt.geminiImageData) {
                return `data:image/jpeg;base64,${receipt.geminiImageData}`;
            }
        }
        return null;
    }, [receipts, currentPreviewIndex]);


    // Function to handle multiple file uploads and processing
    const handleImageUpload = async (event) => {
        const files = Array.from(event.target.files); // Get all selected files
        if (files.length === 0) return;

        setError(null);
        setLoading(true); // Start loading for all files

        // Process files sequentially
        for (const file of files) {
            await processFile(file);
        }

        setLoading(false); // End loading after all files are processed
        // Clear the input field after processing to allow re-uploading the same files
        event.target.value = null;
    };

    // Helper function to process a single file (image or PDF)
    const processFile = async (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();

            reader.onloadend = async () => {
                let geminiBase64Data = null; // Data to send to Gemini (always JPEG)
                let originalFileBase64 = null; // Original file data for download
                let originalFileMimeType = file.type;

                if (file.type.startsWith('image/')) {
                    geminiBase64Data = reader.result.split(',')[1];
                    originalFileBase64 = reader.result.split(',')[1]; // Store original image base64
                } else if (file.type === 'application/pdf') {
                    // Store the original PDF data (as base64) for download
                    // Convert ArrayBuffer to Base64 string for storage
                    originalFileBase64 = btoa(new Uint8Array(reader.result).reduce((data, byte) => data + String.fromCharCode(byte), ''));

                    // For Gemini, convert PDF to JPEG preview
                    if (!window.pdfjsLib) {
                        setError('PDF.js library not loaded. Cannot process PDF.');
                        resolve();
                        return;
                    }
                    const pdfData = new Uint8Array(reader.result);
                    try {
                        const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
                        const page = await pdf.getPage(1);

                        const viewport = page.getViewport({ scale: 2 });
                        const canvas = document.createElement('canvas');
                        const canvasContext = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        await page.render({ canvasContext, viewport }).promise;

                        geminiBase64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]; // Send JPEG to Gemini

                    } catch (pdfError) {
                        console.error("Error rendering PDF for Gemini:", pdfError);
                        setError(`Failed to render PDF: ${file.name} for AI processing. Ensure it is a valid PDF.`);
                        resolve();
                        return;
                    }
                } else {
                    setError(`Unsupported file type: ${file.name}. Please upload an image (JPEG, PNG) or a PDF.`);
                    resolve();
                    return;
                }

                if (geminiBase64Data) {
                    // Pass all necessary data to processReceipt
                    await processReceipt(geminiBase64Data, originalFileBase64, originalFileMimeType, file.name);
                }
                resolve();
            };

            reader.onerror = () => {
                setError(`Failed to read file: ${file.name}.`);
                resolve();
            };

            // Read file based on its type
            if (file.type === 'application/pdf') {
                reader.readAsArrayBuffer(file); // Read PDF as ArrayBuffer
            } else {
                reader.readAsDataURL(file); // Read image as Data URL
            }
        });
    };

    // Function to process the receipt using Gemini API
    // Now accepts geminiBase64Data, originalFileBase64, originalFileMimeType
    const processReceipt = async (geminiBase64Data, originalFileBase64, originalFileMimeType, originalFileName) => {
        try {
            // Updated prompt to include company name
            const prompt = "Extract the following information from this receipt image: date (YYYY-MM-DD), company name, category (classify as 'Restaurant', 'Transport', 'Groceries', 'Utilities', 'Shopping', 'Other'), meal type (classify as 'Lunch' or 'Dinner' based on typical meal times, if unclear, use 'Unknown'), and total cost. Provide the total cost as a number. If any information is missing, use 'N/A'.";

            const payload = {
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: 'image/jpeg', // Always send JPEG to Gemini
                                    data: geminiBase64Data
                                }
                            }
                        ]
                    }
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            "date": { "type": "STRING", "description": "Date of the receipt inYYYY-MM-DD format. If not found, use 'N/A'." },
                            "companyName": { "type": "STRING", "description": "Name of the company or establishment. If not found, use 'N/A'." }, // Added companyName
                            "category": { "type": "STRING", "description": "Category of the expense, such as 'Restaurant', 'Transport', 'Groceries', 'Utilities', 'Shopping', 'Other'. If not found, use 'Other'." },
                            "mealType": { "type": "STRING", "description": "Type of meal, either 'Lunch', 'Dinner', or 'Unknown'. If not found, use 'Unknown'." },
                            "cost": { "type": "NUMBER", "description": "Total cost of the receipt as a number. If not found, use 0." }
                        },
                        "required": ["date", "companyName", "category", "mealType", "cost"] // Added companyName to required
                    }
                }
            };

            const apiUrl = `https://us-central1-turing-booster-461522-a5.cloudfunctions.net/gemini-api-proxy`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ // Send a simplified payload to your Cloud Function proxy
    			prompt: prompt_text, // The prompt to send to Gemini
    			imageData: geminiBase64Data, // The base64 image data (already JPEG for Gemini)
    			mimeType: 'image/jpeg'      // The effective mimeType for the image data
		})
            });

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {

                const jsonString = result.candidates[0].content.parts[0].text;
                const parsedData = result;

                setReceipts(prevReceipts => {
                    const newReceipts = [
                        ...prevReceipts,
                        {
                            ...parsedData,
                            originalFileData: { base64: originalFileBase64, mimeType: originalFileMimeType }, // Store original data
                            geminiImageData: geminiBase64Data, // Store Gemini-ready image data for preview
                            originalFileName: originalFileName
                        }
                    ];
                    // Set current preview index to the newly added receipt
                    setCurrentPreviewIndex(newReceipts.length - 1);
                    return newReceipts;
                });

            } else {
                setError('Could not extract information from one of the receipts. Please check the image or format.');
            }
        } catch (err) {
            console.error("Error processing receipt:", err);
            setError('Failed to process one of the receipts. Please ensure images are clear and try again.');
        }
    };

    // Function to handle starting cell edit mode
    const handleDoubleClick = (rowIndex, fieldName, currentValue) => {
        setEditingCell({ rowIndex, fieldName });
        setEditedValue(currentValue);
    };

    // Function to handle input change during editing
    const handleInputChange = (e) => {
        setEditedValue(e.target.value);
    };

    // Function to handle saving changes when input loses focus or Enter is pressed
    const handleInputBlur = (rowIndex, fieldName) => {
        setReceipts(prevReceipts => {
            const newReceipts = [...prevReceipts];
            if (fieldName === 'cost') {
                newReceipts[rowIndex][fieldName] = parseFloat(editedValue) || 0;
            } else {
                newReceipts[rowIndex][fieldName] = editedValue;
            }
            return newReceipts;
        });
        setEditingCell(null);
        setEditedValue('');
    };

    // Handle Enter key press to save changes
    const handleKeyDown = (e, rowIndex, fieldName) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleInputBlur(rowIndex, fieldName);
        }
    };

    // Function to delete a receipt entry
    const handleDeleteReceipt = (indexToDelete) => {
        setReceipts(prevReceipts => {
            const filteredReceipts = prevReceipts.filter((_, index) => index !== indexToDelete);
            // Adjust currentPreviewIndex if the deleted item was before or is the current one
            if (currentPreviewIndex === indexToDelete) {
                // If the last item was deleted, go to the new last item, else stay at current index
                setCurrentPreviewIndex(filteredReceipts.length > 0 ? Math.min(indexToDelete, filteredReceipts.length - 1) : -1);
            } else if (currentPreviewIndex > indexToDelete) {
                setCurrentPreviewIndex(prev => prev - 1);
            }
            return filteredReceipts;
        });
    };

    // Function to reset all data
    const handleReset = () => {
        setReceipts([]);
        setError(null);
        setLoading(false);
        setCurrentPreviewIndex(-1); // Reset preview index
        setEditingCell(null);
        setEditedValue('');
    };

    // Navigation functions for preview
    const handlePrevPreview = () => {
        setCurrentPreviewIndex(prevIndex =>
            prevIndex === 0 ? receipts.length - 1 : prevIndex - 1
        );
    };

    const handleNextPreview = () => {
        setCurrentPreviewIndex(prevIndex =>
            prevIndex === receipts.length - 1 ? 0 : prevIndex + 1
        );
    };

    // Function to download all receipts as a single ZIP file
    const handleDownloadAll = async () => {
        if (!window.JSZip || !window.saveAs) {
            setError("Download libraries (JSZip, FileSaver) are not loaded. Please try again.");
            return;
        }

        if (receipts.length === 0) {
            setError("No files to download.");
            return;
        }

        setLoading(true);
        setError(null);
        const zip = new window.JSZip();

        receipts.forEach((receipt) => {
            if (receipt.originalFileData && receipt.originalFileName) {
                const originalExtension = receipt.originalFileName.split('.').pop();
                const sanitizedDate = String(receipt.date).replace(/[^a-zA-Z0-9-]/g, '_'); // Allow hyphens for date
                const sanitizedCompany = String(receipt.companyName).replace(/[^a-zA-Z0-9]/g, '_'); // Use companyName
                const sanitizedCategory = String(receipt.category).replace(/[^a-zA-Z0-9]/g, '_');
                const sanitizedMealType = String(receipt.mealType).replace(/[^a-zA-Z0-9]/g, '_');
                const sanitizedCost = receipt.cost ? receipt.cost.toFixed(2).replace('.', '_') : '0_00';

                // Updated filename format to include company
                const newFilename = `${sanitizedDate}_${sanitizedCompany}_${sanitizedCategory}_${sanitizedMealType}_${sanitizedCost}.${originalExtension}`;
                
                // Add file to zip using the original file's base64 data and mime type
                zip.file(newFilename, receipt.originalFileData.base64, { base64: true });
            }
        });

        try {
            const content = await zip.generateAsync({ type: "blob" });
            window.saveAs(content, "receipts.zip"); // Use window.saveAs
        } catch (zipError) {
            console.error("Error zipping files:", zipError);
            setError("Failed to create zip file for download.");
        } finally {
            setLoading(false);
        }
    };

    if (!scriptsLoaded) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center font-sans">
                <style>
                    {`
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                    body {
                        font-family: 'Inter', sans-serif;
                    }
                    `}
                </style>
                <div className="text-center p-6 bg-white rounded-lg shadow-xl">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-lg text-gray-700">Loading necessary libraries...</p>
                    {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-8 font-sans">
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                body {
                    font-family: 'Inter', sans-serif;
                }
                `}
            </style>
            <div className="max-w-4xl mx-auto bg-white p-6 rounded-lg shadow-xl">
                <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">Receipt Scanner Dashboard</h1>
                <p className="text-gray-600 mb-8 text-center">
                    Upload image or PDF files of your receipts to automatically extract date, company name, category, meal type, and cost. Double-click on a cell to edit its value.
                </p>

                <div className="mb-8 p-6 border-2 border-dashed border-gray-300 rounded-lg text-center bg-gray-50 hover:border-blue-500 transition-colors duration-200">
                    <label htmlFor="receipt-upload" className="cursor-pointer block py-4">
                        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                        </svg>
                        <span className="mt-2 block text-sm font-medium text-gray-900">
                            {loading ? 'Processing files...' : 'Click to upload multiple receipt images or PDFs'}
                        </span>
                        <input
                            id="receipt-upload"
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={handleImageUpload}
                            className="sr-only"
                            disabled={loading}
                            multiple
                        />
                    </label>
                    {loading && (
                        <div className="flex justify-center items-center mt-4">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                        </div>
                    )}
                    {error && (
                        <p className="text-red-500 text-sm mt-4">{error}</p>
                    )}
                    {currentImagePreview && (
                        <div className="mt-4">
                            <h3 className="text-lg font-semibold text-gray-700 mb-2">File Preview ({currentPreviewIndex + 1} of {receipts.length}):</h3>
                            <div className="flex items-center justify-center space-x-2">
                                <button
                                    onClick={handlePrevPreview}
                                    disabled={receipts.length <= 1}
                                    className="p-2 bg-gray-200 rounded-full hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>
                                <img src={currentImagePreview} alt="Receipt Preview" className="max-w-full h-auto rounded-md shadow-md mx-auto" style={{ maxHeight: '300px' }} />
                                <button
                                    onClick={handleNextPreview}
                                    disabled={receipts.length <= 1}
                                    className="p-2 bg-gray-200 rounded-full hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {(receipts.length > 0 || currentImagePreview || error) && (
                    <div className="flex justify-center space-x-4 mb-6">
                        <button
                            onClick={handleReset}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-md shadow-sm transition-colors duration-200"
                        >
                            Reset All
                        </button>
                        {receipts.length > 0 && (
                            <button
                                onClick={handleDownloadAll}
                                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md shadow-sm transition-colors duration-200"
                            >
                                Download All
                            </button>
                        )}
                    </div>
                )}

                {receipts.length > 0 && (
                    <div className="mt-8">
                        <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">Extracted Receipts Summary</h2>
                        <div className="overflow-x-auto rounded-lg shadow-md">
                            <table className="min-w-full bg-white border border-gray-200">
                                <thead>
                                    <tr className="bg-blue-50 text-left text-xs font-semibold text-blue-700 uppercase tracking-wider">
                                        <th className="py-3 px-4 border-b">Date</th>
                                        <th className="py-3 px-4 border-b">Company</th> {/* New column header */}
                                        <th className="py-3 px-4 border-b">Category</th>
                                        <th className="py-3 px-4 border-b">Meal Type</th>
                                        <th className="py-3 px-4 border-b">Cost</th>
                                        <th className="py-3 px-4 border-b">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {receipts.map((receipt, index) => (
                                        <tr key={index} className="border-b border-gray-200 hover:bg-gray-50">
                                            <td
                                                onDoubleClick={() => handleDoubleClick(index, 'date', receipt.date)}
                                                className="py-3 px-4 text-sm text-gray-800"
                                            >
                                                {editingCell?.rowIndex === index && editingCell?.fieldName === 'date' ? (
                                                    <input
                                                        type="text"
                                                        value={editedValue}
                                                        onChange={handleInputChange}
                                                        onBlur={() => handleInputBlur(index, 'date')}
                                                        onKeyDown={(e) => handleKeyDown(e, index, 'date')}
                                                        className="w-full p-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    receipt.date
                                                )}
                                            </td>
                                            <td
                                                onDoubleClick={() => handleDoubleClick(index, 'companyName', receipt.companyName)}
                                                className="py-3 px-4 text-sm text-gray-800"
                                            >
                                                {editingCell?.rowIndex === index && editingCell?.fieldName === 'companyName' ? (
                                                    <input
                                                        type="text"
                                                        value={editedValue}
                                                        onChange={handleInputChange}
                                                        onBlur={() => handleInputBlur(index, 'companyName')}
                                                        onKeyDown={(e) => handleKeyDown(e, index, 'companyName')}
                                                        className="w-full p-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    receipt.companyName
                                                )}
                                            </td>
                                            <td
                                                onDoubleClick={() => handleDoubleClick(index, 'category', receipt.category)}
                                                className="py-3 px-4 text-sm text-gray-800"
                                            >
                                                {editingCell?.rowIndex === index && editingCell?.fieldName === 'category' ? (
                                                    <input
                                                        type="text"
                                                        value={editedValue}
                                                        onChange={handleInputChange}
                                                        onBlur={() => handleInputBlur(index, 'category')}
                                                        onKeyDown={(e) => handleKeyDown(e, index, 'category')}
                                                        className="w-full p-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    receipt.category
                                                )}
                                            </td>
                                            <td
                                                onDoubleClick={() => handleDoubleClick(index, 'mealType', receipt.mealType)}
                                                className="py-3 px-4 text-sm text-gray-800"
                                            >
                                                {editingCell?.rowIndex === index && editingCell?.fieldName === 'mealType' ? (
                                                    <input
                                                        type="text"
                                                        value={editedValue}
                                                        onChange={handleInputChange}
                                                        onBlur={() => handleInputBlur(index, 'mealType')}
                                                        onKeyDown={(e) => handleKeyDown(e, index, 'mealType')}
                                                        className="w-full p-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    receipt.mealType
                                                )}
                                            </td>
                                            <td
                                                onDoubleClick={() => handleDoubleClick(index, 'cost', receipt.cost.toFixed(2))}
                                                className="py-3 px-4 text-sm text-gray-800"
                                            >
                                                {editingCell?.rowIndex === index && editingCell?.fieldName === 'cost' ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={editedValue}
                                                        onChange={handleInputChange}
                                                        onBlur={() => handleInputBlur(index, 'cost')}
                                                        onKeyDown={(e) => handleKeyDown(e, index, 'cost')}
                                                        className="w-full p-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    `$${receipt.cost ? receipt.cost.toFixed(2) : '0.00'}`
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-sm text-gray-800">
                                                <button
                                                    onClick={() => handleDeleteReceipt(index)}
                                                    className="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded-md shadow-sm transition-colors duration-200"
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;

