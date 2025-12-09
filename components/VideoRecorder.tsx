import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from './Button';
import { SUPPORTED_MIME_TYPES } from '../constants';
import { RecorderStatus, VideoMetadata, AnalysisResult } from '../types';
import { generateVideoAnalysis } from '../services/geminiService';

const VideoRecorder: React.FC = () => {
  const [status, setStatus] = useState<RecorderStatus>(RecorderStatus.IDLE);
  const [recordedData, setRecordedData] = useState<VideoMetadata | null>(null);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [aiAnalysis, setAiAnalysis] = useState<AnalysisResult | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  // Store cleanup functions for all tracks (mic, system audio, screen)
  const cleanupCallbackRef = useRef<(() => void)[]>([]);

  // Helper to format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startCapture = async () => {
    setError(null);
    cleanupCallbackRef.current = []; // Reset cleanup

    try {
      // 1. Get Screen Stream
      // Note: "display-capture" permission must be enabled in metadata.json
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
            width: { ideal: 1920 }, 
            height: { ideal: 1080 }, 
            frameRate: { ideal: 60 } 
        },
        audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
        }
      });
      
      // Add to cleanup
      cleanupCallbackRef.current.push(() => displayStream.getTracks().forEach(t => t.stop()));

      let finalStream = displayStream;

      // 2. Setup Audio Mixing if enabled
      if (audioEnabled) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            } 
          });
          cleanupCallbackRef.current.push(() => micStream.getTracks().forEach(t => t.stop()));
          
          const audioContext = new AudioContext();
          audioCtxRef.current = audioContext;

          const dest = audioContext.createMediaStreamDestination();
          
          // Mix System Audio (if available)
          if (displayStream.getAudioTracks().length > 0) {
            const sysSource = audioContext.createMediaStreamSource(displayStream);
            sysSource.connect(dest);
          }
          
          // Mix Mic Audio
          const micSource = audioContext.createMediaStreamSource(micStream);
          micSource.connect(dest);

          // Create Combined Stream
          const combinedTracks = [
            ...displayStream.getVideoTracks(),
            ...dest.stream.getAudioTracks()
          ];
          finalStream = new MediaStream(combinedTracks);
          
        } catch (micErr) {
          console.warn("Microphone access denied or unavailable:", micErr);
          // Fallback to just display stream, no error shown to user
        }
      }

      // 3. Setup Preview
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = finalStream;
      }

      // 4. Handle External Stop (User clicks "Stop Sharing" in browser bar)
      finalStream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };

      // 5. Start Recording
      startRecording(finalStream);

    } catch (err) {
      console.error("Error starting capture:", err);
      cleanupResources();
      
      const errorMessage = (err as Error).message || "Failed to start screen capture.";
      
      // Handle permission policy error specifically
      if (errorMessage.includes("display-capture") || errorMessage.includes("permissions policy")) {
          setError("Screen recording is disabled by the environment. Please ensure 'display-capture' permission is allowed in the app configuration.");
      } else if (errorMessage.includes("Permission denied")) {
          setError("Permission denied. You must allow screen access to record.");
      } else {
          setError(errorMessage);
      }
    }
  };

  const startRecording = (stream: MediaStream) => {
    // Prioritize MP4
    let mimeType = 'video/webm';
    if (MediaRecorder.isTypeSupported('video/mp4; codecs=avc1,opus')) {
        mimeType = 'video/mp4; codecs=avc1,opus';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
    } else {
        // Fallback
        for (const type of SUPPORTED_MIME_TYPES) {
            if (MediaRecorder.isTypeSupported(type)) {
                mimeType = type;
                break;
            }
        }
    }

    try {
      const recorder = new MediaRecorder(stream, { 
          mimeType,
          videoBitsPerSecond: 8000000 // 8 Mbps
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        // Try to capture snapshot (might fail if stream is already dead)
        const snapshot = await captureSnapshot(stream);
        
        setRecordedData({
          blob,
          url,
          mimeType,
          duration,
          timestamp: new Date()
        });

        setStatus(RecorderStatus.REVIEW);
        
        // Full cleanup
        cleanupResources();
        
        if (snapshot) {
            analyzeRecording(snapshot);
        }
      };

      recorder.start(1000);
      startTimeRef.current = Date.now();
      setStatus(RecorderStatus.RECORDING);
      
      setRecordingDuration(0);
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

    } catch (err) {
      setError(`Failed to create MediaRecorder: ${(err as Error).message}`);
      cleanupResources();
    }
  };

  const cleanupResources = () => {
      // Clear timer
      if (timerIntervalRef.current) {
          window.clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
      }
      
      // Stop all tracks (mic, system audio, screen)
      cleanupCallbackRef.current.forEach(cleanup => cleanup());
      cleanupCallbackRef.current = [];
      
      // Close Audio Context
      if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(e => console.error("Error closing audio context", e));
          audioCtxRef.current = null;
      }

      // Clear Preview
      if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null;
      }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const captureSnapshot = async (stream: MediaStream): Promise<string | null> => {
    try {
        let videoElement = videoPreviewRef.current;
        let isTempElement = false;

        // If current preview is unavailable or mismatched, create temp
        if (!videoElement || videoElement.srcObject !== stream) {
            videoElement = document.createElement('video');
            videoElement.muted = true;
            videoElement.srcObject = stream;
            videoElement.playsInline = true;
            isTempElement = true;
            
            // Try to play to get a frame
            await new Promise<void>((resolve, reject) => {
                if (!videoElement) return reject();
                videoElement.onloadedmetadata = () => {
                    videoElement!.play().then(() => resolve()).catch(reject);
                };
                videoElement.onerror = reject;
                // Timeout safety
                setTimeout(reject, 1000); 
            });
        }

        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth || 1920;
        canvas.height = videoElement.videoHeight || 1080;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        
        if (isTempElement) {
            videoElement.pause();
            videoElement.srcObject = null;
            videoElement.remove();
        }
        
        return dataUrl.split(',')[1];
    } catch (e) {
        // Stream probably ended before we could capture
        console.warn("Snapshot skipped:", e);
        return null;
    }
  };

  const analyzeRecording = async (base64Image: string) => {
    setIsAnalyzing(true);
    setAiAnalysis(null);
    try {
        const result = await generateVideoAnalysis(base64Image);
        setAiAnalysis(result);
    } catch (e) {
        console.error("AI Analysis failed", e);
    } finally {
        setIsAnalyzing(false);
    }
  };

  const downloadVideo = () => {
    if (!recordedData) return;
    const a = document.createElement('a');
    a.href = recordedData.url;
    
    // Smart extension detection
    let ext = 'webm';
    if (recordedData.mimeType.includes('mp4')) {
        ext = 'mp4';
    }
    
    a.download = `${aiAnalysis?.title ? aiAnalysis.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'screen_recording'}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const reset = () => {
    cleanupResources();
    setStatus(RecorderStatus.IDLE);
    setRecordedData(null);
    setAiAnalysis(null);
    setError(null);
    setRecordingDuration(0);
  };

  // Ensure cleanup on unmount
  useEffect(() => {
    return () => cleanupResources();
  }, []);

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      
      {/* Header Area */}
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400 mb-2">
           Screen Recorder
        </h2>
        <p className="text-slate-400">Capture, Analyze, and Download</p>
      </div>

      {/* Main Display Area */}
      <div className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-700 mb-8 group">
        
        {/* Error Message */}
        {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-50 p-4">
                <div className="bg-rose-900/40 border border-rose-500/50 text-rose-200 px-6 py-6 rounded-xl max-w-md text-center backdrop-blur-sm">
                    <svg className="w-12 h-12 mx-auto text-rose-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="font-semibold mb-2">Recording Error</p>
                    <p className="text-sm opacity-90">{error}</p>
                    <button onClick={() => setError(null)} className="mt-6 px-4 py-2 bg-rose-600 hover:bg-rose-500 rounded-lg text-white text-sm font-medium transition-colors">
                        Dismiss
                    </button>
                </div>
            </div>
        )}

        {/* Video Preview */}
        {status === RecorderStatus.REVIEW && recordedData ? (
          <video 
            src={recordedData.url} 
            controls 
            className="w-full h-full object-contain" 
            autoPlay
          />
        ) : (
            <video 
                ref={videoPreviewRef}
                autoPlay 
                muted 
                className={`w-full h-full object-contain ${status === RecorderStatus.IDLE ? 'hidden' : 'block'}`}
            />
        )}

        {/* Idle State Placeholder */}
        {status === RecorderStatus.IDLE && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                 <div className="w-24 h-24 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 ring-1 ring-slate-700">
                    <svg className="w-10 h-10 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                 </div>
                 <p className="text-xl font-medium text-slate-300">Ready to capture</p>
                 <p className="text-sm mt-2">Click 'Start Recording' to begin</p>
            </div>
        )}
        
        {/* Timer Overlay */}
        {status === RecorderStatus.RECORDING && (
            <div className="absolute top-4 right-4 bg-rose-500/90 backdrop-blur-sm text-white px-3 py-1 rounded-full font-mono text-sm flex items-center animate-pulse shadow-lg">
                <div className="w-2 h-2 bg-white rounded-full mr-2"></div>
                REC {formatTime(recordingDuration)}
            </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-6">
        
        {/* Setup Toggles (Only visible when Idle) */}
        {status === RecorderStatus.IDLE && (
            <div className="flex gap-4">
                 <label className="flex items-center gap-3 px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 cursor-pointer hover:bg-slate-750 hover:border-slate-600 transition-all">
                    <div className={`w-5 h-5 rounded flex items-center justify-center border ${audioEnabled ? 'bg-indigo-600 border-indigo-600' : 'border-slate-500'}`}>
                        {audioEnabled && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>}
                    </div>
                    <input 
                        type="checkbox" 
                        checked={audioEnabled}
                        onChange={(e) => setAudioEnabled(e.target.checked)}
                        className="hidden"
                    />
                    <span className="text-sm font-medium text-slate-300">Include Microphone</span>
                 </label>
            </div>
        )}

        <div className="flex gap-4">
            {status === RecorderStatus.IDLE && (
                <Button onClick={startCapture} icon={
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                }>
                    Start Recording
                </Button>
            )}

            {status === RecorderStatus.RECORDING && (
                <Button variant="danger" onClick={stopRecording} icon={
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                }>
                    Stop Recording
                </Button>
            )}

            {status === RecorderStatus.REVIEW && (
                <>
                    <Button variant="secondary" onClick={reset}>
                        New Recording
                    </Button>
                    <div className="flex flex-col gap-1 items-center">
                        <Button onClick={downloadVideo} icon={
                            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                        }>
                            Download {recordedData?.mimeType.includes('mp4') ? 'MP4' : 'Video'}
                        </Button>
                        <span className="text-xs font-mono text-slate-500 uppercase">
                            Format: {recordedData?.mimeType.includes('mp4') ? 'MP4' : 'WebM'}
                        </span>
                    </div>
                </>
            )}
        </div>
      </div>

      {/* AI Analysis Result Section */}
      {status === RecorderStatus.REVIEW && (
          <div className="mt-12 border-t border-slate-700 pt-8 animate-fade-in-up">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
                      <span className="text-2xl">✨</span> AI Analysis
                  </h3>
                  {isAnalyzing && <span className="text-sm text-indigo-400 animate-pulse flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Generating insights...
                  </span>}
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 shadow-inner">
                {isAnalyzing ? (
                     <div className="space-y-4">
                        <div className="h-6 bg-slate-700 rounded w-1/3 animate-pulse"></div>
                        <div className="h-4 bg-slate-700 rounded w-3/4 animate-pulse"></div>
                        <div className="flex gap-2">
                            <div className="h-8 w-20 bg-slate-700 rounded-full animate-pulse"></div>
                            <div className="h-8 w-20 bg-slate-700 rounded-full animate-pulse"></div>
                        </div>
                     </div>
                ) : aiAnalysis ? (
                    <div className="space-y-4">
                        <h4 className="text-xl font-bold text-white tracking-tight">{aiAnalysis.title}</h4>
                        <p className="text-slate-300 leading-relaxed border-l-4 border-indigo-500 pl-4">{aiAnalysis.summary}</p>
                        <div className="flex flex-wrap gap-2 pt-2">
                            {aiAnalysis.tags.map((tag, i) => (
                                <span key={i} className="px-3 py-1 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-full text-xs font-medium hover:bg-indigo-500/20 transition-colors cursor-default">
                                    #{tag}
                                </span>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="text-center text-slate-500 py-8">
                        <p>No analysis generated.</p>
                        <button onClick={() => recordedData && captureSnapshot(new MediaStream()).then(s => s && analyzeRecording(s))} className="mt-2 text-indigo-400 hover:text-indigo-300 text-sm underline">
                            Retry Analysis
                        </button>
                    </div>
                )}
              </div>
          </div>
      )}
    </div>
  );
};

export default VideoRecorder;