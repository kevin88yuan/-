import React from 'react';
import VideoRecorder from './components/VideoRecorder';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 selection:bg-indigo-500/30">
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                 <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                 </svg>
              </div>
              <span className="font-bold text-xl tracking-tight">ScreenCast Pro</span>
            </div>
            <div className="flex items-center gap-4">
                <a href="#" className="text-sm font-medium text-slate-400 hover:text-indigo-400 transition-colors">Documentation</a>
                <div className="h-4 w-px bg-slate-700"></div>
                <span className="text-xs px-2 py-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">v1.0.0</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="py-12">
        <VideoRecorder />
      </main>

      <footer className="border-t border-slate-800 mt-auto py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-500 text-sm">
            <p>Powered by React & Google Gemini</p>
            <p className="mt-2 text-xs">Note: MP4 support depends on browser capabilities (Chrome/Edge recommended for native MP4).</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
