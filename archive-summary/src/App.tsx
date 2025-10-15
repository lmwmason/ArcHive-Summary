import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

declare global {
  interface Window {
    kakao_ad_area: {
      reloadAll: () => void;
    } | undefined;
  }
}

interface SummarizeApiInput {
    text?: string;
    pdfBase64?: string;
    focusInstruction: string;
    mimeType?: string;
}

const reloadKakaoAd = () => {
    if (window.kakao_ad_area && typeof window.kakao_ad_area.reloadAll === 'function') {
        window.kakao_ad_area.reloadAll();
    }
};

const LANGUAGES = [
    { code: 'ko', name: '한국어' },
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文 (Chinese)' },
    { code: 'ja', name: '日本語 (Japanese)' },
    { code: 'es', name: 'Español (Spanish)' },
];

const summarizeApi = async (input: SummarizeApiInput): Promise<string> => {
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    const MAX_RETRIES = 5;

    const systemPrompt = "You are an expert academic research assistant. Your task is to analyze the provided content (which may be raw text or a PDF file's content) and generate a comprehensive, structured summary based on the user's specific focus instructions. Ensure the output is accurate and easy to understand. Please output the summary in a professional markdown format.";

    const parts = [];
    let userQuery = input.focusInstruction.trim() || "Provide a detailed summary of the main findings and methodology.";
    
    if (input.pdfBase64 && input.mimeType) {
        userQuery = `Analyze this PDF file thoroughly. The main instruction is: ${userQuery}`;
        parts.push({ text: userQuery });
        parts.push({
            inlineData: {
                mimeType: input.mimeType,
                data: input.pdfBase64
            }
        });
    } 
    else if (input.text) {
        parts.push({ text: `Content to summarize: \n\n---START CONTENT---\n${input.text}\n---END CONTENT---\n\nUser Instruction: ${userQuery}` });
    } else {
        return "Error: No valid content or file provided for summarization.";
    }

    const payload = {
        contents: [{ parts: parts }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
    };
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 429 && attempt < MAX_RETRIES - 1) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    continue; 
                }
                throw new Error(`API request failed with status: ${response.status}`);
            }

            const result = await response.json();
            const candidate = result.candidates?.[0];

            if (candidate && candidate.content?.parts?.[0]?.text) {
                return candidate.content.parts[0].text;
            } else {
                throw new Error("API response was valid, but missing generated text content.");
            }
        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed:`, error);
            if (attempt === MAX_RETRIES - 1) {
                return `Error: Summarization failed after ${MAX_RETRIES} attempts. Details: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return "Error: Summarization logic failed to execute.";
};

const App: React.FC = () => {
    const [inputText, setInputText] = useState('');
    const [focusInstruction, setFocusInstruction] = useState('');
    const [outputLanguage, setOutputLanguage] = useState('ko');
    const [summary, setSummary] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload'); 
    
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [pdfBase64, setPdfBase64] = useState<string | null>(null);
    
    const adScriptRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (summary && !isLoading && adScriptRef.current) {
            const ins = adScriptRef.current.querySelector('.kakao_ad_area');
            if (!ins) return;

            const existingScript = adScriptRef.current.querySelector('script');
            if (existingScript) {
                existingScript.remove();
            }

            const script = document.createElement("script");
            script.type = "text/javascript";
            script.src = "//t1.daumcdn.net/kas/static/ba.min.js";
            script.async = true;
            
            adScriptRef.current.appendChild(script);
        }
    }, [summary, isLoading]);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        setSummary('');

        if (file && file.type === "application/pdf") {
            setSelectedFile(file);
            
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.result && typeof reader.result === 'string') {
                    const base64Content = reader.result.split(',')[1];
                    setPdfBase64(base64Content);
                }
            };
            reader.onerror = (error) => {
                console.error("Error reading file:", error);
                setSelectedFile(null);
                setPdfBase64(null);
            };
            reader.readAsDataURL(file);
        } else {
            setSelectedFile(null);
            setPdfBase64(null);
        }
    };
    
    const handleRemoveFile = () => {
        setSelectedFile(null);
        setPdfBase64(null);
        const fileInput = document.getElementById('pdf-upload-input') as HTMLInputElement;
        if (fileInput) fileInput.value = ""; 
    };

    const handleSummarize = async () => {
        const isPasteModeValid = activeTab === 'paste' && inputText.trim();
        const isUploadModeValid = activeTab === 'upload' && pdfBase64 && selectedFile;
        const canSummarize = isPasteModeValid || isUploadModeValid;

        if (!canSummarize) {
            console.log('Summarization not possible: Check content or selected file.');
            return;
        }

        setIsLoading(true);
        setSummary('');

        const languageInstruction = LANGUAGES.find(lang => lang.code === outputLanguage)?.name || 'Korean';
        let combinedInstruction = focusInstruction.trim();
        combinedInstruction += combinedInstruction.length > 0 ? 
            `. And translate the final summary into ${languageInstruction}.` : 
            `Translate the final summary into ${languageInstruction}.`;


        let apiInput: SummarizeApiInput;

        if (activeTab === 'upload' && pdfBase64 && selectedFile) {
            apiInput = {
                pdfBase64: pdfBase64,
                mimeType: selectedFile.type,
                focusInstruction: combinedInstruction
            };
        } else if (activeTab === 'paste' && inputText.trim()) {
            apiInput = {
                text: inputText,
                focusInstruction: combinedInstruction
            };
        } else {
            setIsLoading(false);
            return;
        }

        try {
            const result = await summarizeApi(apiInput);
            setSummary(result);
        } catch (error) {
            console.error('Summarization failed:', error);
            setSummary("An error occurred during summarization.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = () => {
        if (summary) {
            const textarea = document.createElement('textarea');
            textarea.value = summary;
            document.body.appendChild(textarea);
            textarea.select();
            
            try {
                document.execCommand('copy');
                console.log('Summary content copied successfully!');
            } catch (err) {
                console.error('Could not copy text: ', err);
            }
            document.body.removeChild(textarea);
        }
    };

    const renderTabButton = (tabName: 'upload' | 'paste', label: string) => (
        <button
            className={`tab-button ${activeTab === tabName 
                ? 'tab-button-active' 
                : 'tab-button-inactive'
            } ${isLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={() => { 
                setActiveTab(tabName);
                setSummary('');
            }}
            disabled={isLoading}
        >
            {label}
        </button>
    );

    const isSummarizeDisabled = isLoading || 
        ((activeTab === 'upload' && !pdfBase64) || (activeTab === 'paste' && !inputText.trim()));

    return (
        <div className="app-container">
            <div className="main-card">

                <header className="header-area">
                    <h1 className="title-main">
                        <span className="title-accent">ArcHive</span>-Summary
                    </h1>
                    <p className="subtitle">
                        Advanced AI Summarization Tool.
                    </p>
                </header>

                <div className="tab-navigation">
                    {renderTabButton('upload', '1. PDF 업로드')}
                    {renderTabButton('paste', '1. 텍스트 붙여넣기')}
                </div>

                <div className="input-section">
                    
                    {activeTab === 'upload' && (
                        <div className="w-full">
                            <label className="input-label">
                                1. 학술 논문 업로드 (PDF 파일)
                            </label>
                            <div 
                                className="upload-box"
                                onClick={() => {
                                    if (!isLoading) {
                                        document.getElementById('pdf-upload-input')?.click();
                                    }
                                }} 
                                style={{ 
                                    cursor: isLoading ? 'not-allowed' : 'pointer',
                                    borderColor: selectedFile ? '#22d3ee' : '#374151'
                                }}
                            >
                                <input 
                                    type="file" 
                                    id="pdf-upload-input" 
                                    accept="application/pdf"
                                    onChange={handleFileUpload}
                                    style={{ display: 'none' }}
                                    disabled={isLoading}
                                />
                                
                                {selectedFile ? (
                                    <div className="uploaded-file-details">
                                        <svg className="upload-icon text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-3-3v6m-4 5h10a2 2 0 002-2V7a2 2 0 00-2-2H9a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                        <p className="upload-text-main text-cyan-400 font-bold">{selectedFile.name}</p>
                                        <p className="upload-text-advantage text-sm text-green-400">분석 준비 완료. "요약하기" 버튼을 클릭하세요.</p>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleRemoveFile(); }} 
                                            className="remove-file-button"
                                            disabled={isLoading}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 014 4v2a3 3 0 00.12.98"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 17l-4-4m0 0l-4 4m4-4v11"></path></svg>
                                        <p className="upload-text-main">PDF 파일을 업로드하려면 클릭하세요</p>
                                        <p className="upload-text-advantage">
                                            <span className='text-white'>—</span> PDF 파일만 지원됩니다 <span className='text-white'>—</span>
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'paste' && (
                        <div className="w-full">
                            <label className="input-label">
                                1. 학술 논문 텍스트 붙여넣기
                            </label>
                            <textarea
                                className="text-input"
                                placeholder="여기에 학술 논문 텍스트를 붙여넣으세요."
                                value={inputText}
                                onChange={(e) => {
                                    setInputText(e.target.value);
                                    setSummary('');
                                }}
                                disabled={isLoading}
                            />
                        </div>
                    )}
                    <div className='flex flex-col sm:flex-row gap-4'>
                         <div className='flex-1'>
                            <label className="input-label focus-instruction-label">
                                2. 요약 상세 지침 (선택 사항)
                            </label>
                            <textarea
                                className="pill-textarea-focus"
                                placeholder="예: 고등학생이 이해할 수 있도록 간단하게 요약해 주세요."
                                rows={2}
                                value={focusInstruction}
                                onChange={(e) => setFocusInstruction(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <div className='sm:w-48'>
                            <label className="input-label focus-instruction-label">
                                3. 결과 언어 선택
                            </label>
                             <div className="language-select-container">
                                <select
                                    className="language-select"
                                    value={outputLanguage}
                                    onChange={(e) => setOutputLanguage(e.target.value)}
                                    disabled={isLoading}
                                >
                                    {LANGUAGES.map(lang => (
                                        <option key={lang.code} value={lang.code}>
                                            {lang.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                   
                    <div className="pill-container-summarize">
                        <button
                            className={`summarize-button ${isSummarizeDisabled
                                ? 'summarize-button-disabled'
                                : 'summarize-button-enabled'
                            }`}
                            onClick={handleSummarize}
                            disabled={isSummarizeDisabled}
                        >
                            {isLoading ? (
                                <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : '요약하기'}
                        </button>
                    </div>
                </div>

                {!summary && isLoading && (
                    <div className="text-center py-8">
                        <div className="animate-pulse text-xl font-medium text-cyan-400 italic">
                            심층 지식 구조 분석 중...
                        </div>
                    </div>
                )}

                {summary && !isLoading && (
                    <div className="summary-output">
                        <h2 className="report-title">
                            <span role="img" aria-label="report">⚡️</span> 최종 보고서
                        </h2>
                        <div className="report-content markdown-body">
                            <ReactMarkdown>{summary}</ReactMarkdown>
                        </div>
                        <button
                            className="copy-button"
                            onClick={handleCopy}
                        >
                            보고서 복사
                        </button>
                        <div ref={adScriptRef} style={{ marginTop: '20px', textAlign: 'center' }}>
                            <ins
                                className="kakao_ad_area"
                                style={{ display: "none" }}
                                data-ad-unit="DAN-DCDdPQyAztWNuXAc"
                                data-ad-width="320"
                                data-ad-height="50"
                            ></ins>
                        </div>
                    </div>
                )}
                
            </div>
        </div>
    );
};

export default App;