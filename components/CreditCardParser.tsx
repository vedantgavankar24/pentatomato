'use client';

import React, { useState, useCallback } from 'react';
import { Upload, FileText, CreditCard, Calendar, DollarSign, AlertCircle, CheckCircle2, Loader2, Download } from 'lucide-react';

interface ParsedData {
  issuer: string;
  cardLast4: string;
  statementPeriod: string;
  dueDate: string;
  totalBalance: string;
  minimumPayment: string;
}

// Utility for PDF.js
const setupPdfWorker = () => {
  if (typeof window !== 'undefined') {
    const pdfjsLib = require('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
    return pdfjsLib;
  }
  return null;
};

const CreditCardParser = () => {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParsedData | null>(null);
  const [error, setError] = useState<string>('');
  const [dragActive, setDragActive] = useState(false);
  const [password, setPassword] = useState<string>('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Your OpenAI key from environment variable (prefixed with NEXT_PUBLIC_)
  const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY;

  const extractPdfText = async (file: File, pdfPassword?: string) => {
    const pdfjsLib = setupPdfWorker();
    if (!pdfjsLib) throw new Error('PDF.js not available');
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      password: pdfPassword || '',
    });

    return loadingTask.promise.then(async (pdf: any) => {
      let out = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        out += pageText + '\n';
      }
      return out;
    });
  };

  const callOpenAI = async (text: string): Promise<string> => {
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API Key is not configured. Set NEXT_PUBLIC_OPENAI_API_KEY in .env');
    }

    const prompt = `
Extract the following fields in JSON format from the credit card statement text:
issuer, cardLast4, statementPeriod, dueDate, totalBalance, minimumPayment.
If a field cannot be found, use "Not Found".

Statement text:
${text}
`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      throw new Error(errorJson?.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const parsePDF = async (file: File, pdfPassword?: string) => {
    setParsing(true);
    setError('');
    setResult(null);
    setNeedsPassword(false);

    try {
      const text = await extractPdfText(file, pdfPassword);
      const openAIResponse = await callOpenAI(text);

      let parsed: ParsedData;

      try {
        parsed = JSON.parse(openAIResponse);
      } catch {
        // try to extract JSON substring if invalid JSON received directly
        const jsonMatch = openAIResponse.match(/\{[\s\S]+\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {
          issuer: 'Not Found',
          cardLast4: 'Not Found',
          statementPeriod: 'Not Found',
          dueDate: 'Not Found',
          totalBalance: 'Not Found',
          minimumPayment: 'Not Found',
        };
      }

      setResult(parsed);
      setNeedsPassword(false);
      setPendingFile(null);
      setPassword('');
    } catch (err: any) {
      if (err.message?.toLowerCase()?.includes('password')) {
        setNeedsPassword(true);
        setPendingFile(file);
        setError('This PDF is password protected. Please enter the correct password below.');
      } else {
        setError(err.message || 'Failed to parse PDF');
      }
    } finally {
      setParsing(false);
    }
  };

  // -- Your existing handler functions -- //

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        setFile(droppedFile);
        parsePDF(droppedFile);
      } else {
        setError('Please upload a PDF file');
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setPassword('');
      parsePDF(selectedFile);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingFile && password) {
      parsePDF(pendingFile, password);
    }
  };

  const downloadJSON = () => {
    if (!result) return;
    const dataStr = JSON.stringify(result, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `statement-data-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #1e1b4b 0%, #7e22ce 50%, #1e1b4b 100%)',
      padding: '1rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{
        maxWidth: '1400px',
        width: '100%',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
            <CreditCard style={{ width: '72px', height: '72px', color: '#c084fc' }} />
          </div>
          <h1 style={{ fontSize: '3.5rem', fontWeight: 'bold', color: 'white', marginBottom: '1rem', margin: 0 }}>
            Credit Card Statement Parser
          </h1>
          <p style={{ color: '#e9d5ff', fontSize: '1.3rem', margin: '1rem auto 1.25rem' }}>
            Automatically extract key information from your credit card statements
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
            {['ICICI Bank', 'HDFC Bank', 'SBI', 'Axis Bank', 'American Express', 'Chase', 'Citibank', 'Capital One', 'Discover'].map((issuer) => (
              <span key={issuer} style={{
                background: 'rgba(126, 34, 206, 0.5)',
                color: '#e9d5ff',
                padding: '0.5rem 1.25rem',
                borderRadius: '9999px',
                fontSize: '1rem',
                fontWeight: '500'
              }}>
                {issuer}
              </span>
            ))}
          </div>
        </div>

        {/* Upload Area */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          borderRadius: '1rem',
          padding: '1.25rem',
          marginBottom: '1.25rem',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          flexShrink: 0
        }}>
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            style={{
              border: dragActive ? '3px dashed #c084fc' : '3px dashed rgba(216, 180, 254, 0.5)',
              borderRadius: '0.75rem',
              padding: '2rem',
              textAlign: 'center',
              transition: 'all 0.3s',
              background: dragActive ? 'rgba(126, 34, 206, 0.2)' : 'transparent',
              cursor: 'pointer'
            }}
          >
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              id="file-upload"
              disabled={parsing}
            />
            <label htmlFor="file-upload" style={{ cursor: 'pointer', display: 'block' }}>
              <Upload style={{ width: '48px', height: '48px', margin: '0 auto 0.75rem', color: '#d8b4fe' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'white', marginBottom: '0.4rem', margin: 0 }}>
                {file ? file.name : 'Upload Credit Card Statement'}
              </h3>
              <p style={{ color: '#e9d5ff', fontSize: '0.875rem', margin: '0.4rem 0 0' }}>
                Drag and drop your PDF here, or click to browse
              </p>
            </label>
          </div>

          {parsing && (
            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#e9d5ff' }}>
              <Loader2 style={{ width: '1.1rem', height: '1.1rem', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '0.9rem' }}>Parsing your statement...</span>
            </div>
          )}

          {error && (
            <div style={{
              marginTop: '1rem',
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem'
            }}>
              <AlertCircle style={{ width: '1.1rem', height: '1.1rem', color: '#fca5a5', flexShrink: 0 }} />
              <p style={{ color: '#fecaca', fontSize: '0.8rem', margin: 0 }}>{error}</p>
            </div>
          )}

          {needsPassword && (
            <form onSubmit={handlePasswordSubmit} style={{
              marginTop: '1rem',
              background: 'rgba(168, 85, 247, 0.2)',
              border: '1px solid rgba(168, 85, 247, 0.5)',
              borderRadius: '0.5rem',
              padding: '1rem'
            }}>
              <label style={{
                display: 'block',
                color: '#e9d5ff',
                fontSize: '0.875rem',
                fontWeight: '600',
                marginBottom: '0.5rem'
              }}>
                Enter PDF Password:
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.375rem',
                    border: '1px solid rgba(216, 180, 254, 0.3)',
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    fontSize: '0.875rem',
                    outline: 'none'
                  }}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!password || parsing}
                  style={{
                    padding: '0.5rem 1.25rem',
                    borderRadius: '0.375rem',
                    border: 'none',
                    background: password ? '#7c3aed' : 'rgba(124, 58, 237, 0.5)',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    cursor: password ? 'pointer' : 'not-allowed',
                    transition: 'background 0.3s'
                  }}
                  onMouseOver={(e) => password && (e.currentTarget.style.background = '#6d28d9')}
                  onMouseOut={(e) => password && (e.currentTarget.style.background = '#7c3aed')}
                >
                  Unlock
                </button>

                <style jsx>{`
                  input::placeholder {
                    color: white !important;
                    opacity: 0.7;
                  }
                `}</style>
              </div>
            </form>
          )}
        </div>

        {/* Results */}
        {result && (
          <div style={{
            background: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
            borderRadius: '1rem',
            padding: '1.25rem',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            flexShrink: 0,
            marginBottom: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 style={{ width: '1.5rem', height: '1.5rem', color: '#4ade80' }} />
                <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'white', margin: 0 }}>Extracted Data</h2>
              </div>
              <button
                onClick={downloadJSON}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: '#7c3aed',
                  color: 'white',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '0.4rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  transition: 'background 0.3s'
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = '#6d28d9')}
                onMouseOut={(e) => (e.currentTarget.style.background = '#7c3aed')}
              >
                <Download style={{ width: '0.9rem', height: '0.9rem' }} />
                <span>Export JSON</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              {[
                { icon: CreditCard, label: 'Card Issuer', value: result.issuer },
                { icon: FileText, label: 'Card Last 4 Digits', value: `•••• ${result.cardLast4}` },
                { icon: Calendar, label: 'Statement Period', value: result.statementPeriod },
                { icon: Calendar, label: 'Payment Due Date', value: result.dueDate },
                { icon: DollarSign, label: 'Total Balance', value: result.totalBalance },
                { icon: DollarSign, label: 'Minimum Payment', value: result.minimumPayment }
              ].map((item, idx) => (
                <div key={idx} style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '0.6rem',
                  padding: '1rem',
                  border: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <item.icon style={{ width: '1rem', height: '1rem', color: '#c084fc' }} />
                    <h3 style={{
                      fontSize: '0.65rem',
                      fontWeight: '600',
                      color: '#d8b4fe',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      margin: 0
                    }}>
                      {item.label}
                    </h3>
                  </div>
                  <p style={{
                    fontSize: idx > 3 ? '1.2rem' : '0.95rem',
                    fontWeight: 'bold',
                    color: 'white',
                    margin: 0,
                    fontFamily: item.label.includes('Last 4') ? 'monospace' : 'inherit'
                  }}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Section */}
        {!result && (
          <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(10px)',
            borderRadius: '0.75rem',
            padding: '1rem',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            flexShrink: 0
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'white', marginBottom: '0.75rem', margin: 0 }}>
              Supported Data Points
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.5rem',
              color: '#e9d5ff',
              fontSize: '0.8rem',
              marginTop: '0.75rem'
            }}>
              {[
                'Card Issuer Detection',
                'Card Last 4 Digits',
                'Statement Period',
                'Payment Due Date',
                'Total Balance',
                'Minimum Payment'
              ].map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <CheckCircle2 style={{ width: '0.9rem', height: '0.9rem', color: '#4ade80', flexShrink: 0 }} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding: 0;
          overflow: hidden;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      ` }} />
    </div>
  );
};

export default CreditCardParser;
