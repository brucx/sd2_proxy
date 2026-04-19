import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Download, Code2, Home, Gamepad2 } from 'lucide-react';
import { generateApiDocsMarkdown } from '../content/apiDocs';

function ApiDocs() {
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle');
  const baseUrl = 'https://sd2.vectorspace.cn';
  const markdown = generateApiDocsMarkdown(baseUrl);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState('done');
    } catch {
      setCopyState('failed');
    }
  };

  const handleDownloadMarkdown = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sd2-proxy-api-reference.md';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="min-h-screen bg-[#050508] px-4 py-6 text-slate-100 sm:px-6 lg:px-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/40 via-[#050508] to-[#050508]"
      style={{ fontFamily: '"Outfit", "Inter", "Segoe UI", sans-serif' }}
    >
      <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/10 bg-slate-900/50 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 mb-2">
              <Code2 className="h-4 w-4" />
              <p className="text-xs font-bold uppercase tracking-widest text-cyan-400">API Documentation</p>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">SD2 Proxy API 对接文档</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white"
            >
              <Home className="h-4 w-4" />
              主控台
            </Link>
            <Link
              to="/playground"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white"
            >
              <Gamepad2 className="h-4 w-4" />
              Playground
            </Link>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-cyan-500/10 border border-cyan-500/30 px-5 py-2.5 text-sm font-medium text-cyan-300 transition-all hover:bg-cyan-500/20 hover:shadow-[0_0_20px_rgba(6,182,212,0.2)]"
            >
              <Copy className="h-4 w-4 transition-transform group-hover:scale-110" />
              {copyState === 'done' ? '已复制 ✔' : copyState === 'failed' ? '复制失败 ❌' : '复制 Markdown'}
            </button>
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/10 hover:border-white/20"
            >
              <Download className="h-4 w-4" />
              下载 .md
            </button>
          </div>
        </div>
        <div className="group relative">
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-b from-cyan-500/10 to-transparent opacity-0 blur-lg transition duration-500 group-hover:opacity-100"></div>
          <pre className="relative overflow-x-auto whitespace-pre-wrap rounded-2xl border border-white/5 bg-[#0a0a0c] px-6 py-6 text-sm leading-relaxed text-slate-300 shadow-inner block">
            {markdown}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default ApiDocs;
