import { useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

interface RefItem {
  id: number;
  url: string;
  role: string;
}

let nextId = 1;

const HelpText = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{children}</p>
);

function Playground() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('doubao-seedance-2-0-260128');
  const [prompt, setPrompt] = useState('');
  const [refImages, setRefImages] = useState<RefItem[]>([]);
  const [refVideos, setRefVideos] = useState<RefItem[]>([]);
  const [refAudios, setRefAudios] = useState<RefItem[]>([]);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [ratio, setRatio] = useState('adaptive');
  const [resolution, setResolution] = useState('720p');
  const [duration, setDuration] = useState(5);
  const [watermark, setWatermark] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [taskId, setTaskId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showCurl, setShowCurl] = useState(false);
  const [showResponseExample, setShowResponseExample] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const buildCurlCreate = (body: any) => {
    const key = apiKey || 'YOUR_API_KEY';
    return `curl -X POST '${baseUrl}/api/v1/doubao/create' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${key}' \\
  -d '${JSON.stringify(body, null, 2)}'`;
  };

  const buildCurlGetResult = () => {
    const key = apiKey || 'YOUR_API_KEY';
    const tid = taskId || 'TASK_ID';
    return `curl -X POST '${baseUrl}/api/v1/doubao/get_result' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${key}' \\
  -d '{"id": "${tid}"}'`;
  };

  const copyCurl = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 1500);
  }, []);

  const sampleCreateResponse = {
    id: "task_abcdefg1234567"
  };

  const sampleGetResultResponse = {
    id: "task_abcdefg1234567",
    model: "doubao-seedance-2-0-260128",
    status: "succeeded",
    error: null,
    content: {
      video_url: "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedance-2-0/xxx.mp4?X-Tos-Algorithm=...",
      last_frame_url: null,
      file_url: null
    },
    usage: { completion_tokens: 108900 },
    framespersecond: 24,
    created_at: 1774105394,
    updated_at: 1774105570,
    seed: 52050,
    revised_prompt: null,
    service_tier: "default",
    execution_expires_after: 172800,
    generate_audio: true,
    duration: 5,
    ratio: "16:9",
    resolution: "720p",
    draft: false,
    draft_task_id: null,
    _request_id: ""
  };

  const addImage = () => {
    setRefImages(prev => [...prev, { id: nextId++, url: '', role: 'reference_image' }]);
  };
  const addVideo = () => {
    setRefVideos(prev => [...prev, { id: nextId++, url: '', role: 'reference_video' }]);
  };
  const addAudio = () => {
    setRefAudios(prev => [...prev, { id: nextId++, url: '', role: 'reference_audio' }]);
  };

  const removeItem = (setter: React.Dispatch<React.SetStateAction<RefItem[]>>, id: number) => {
    setter(prev => prev.filter(item => item.id !== id));
  };

  const updateUrl = (setter: React.Dispatch<React.SetStateAction<RefItem[]>>, id: number, url: string) => {
    setter(prev => prev.map(item => item.id === id ? { ...item, url } : item));
  };

  const updateRole = (setter: React.Dispatch<React.SetStateAction<RefItem[]>>, id: number, role: string) => {
    setter(prev => prev.map(item => item.id === id ? { ...item, role } : item));
  };

  const buildRequestBody = () => {
    const content: any[] = [];

    if (prompt.trim()) {
      content.push({ type: 'text', text: prompt });
    }

    refImages.forEach(img => {
      if (img.url.trim()) {
        content.push({
          type: 'image_url',
          image_url: { url: img.url.trim() },
          role: img.role
        });
      }
    });

    refVideos.forEach(vid => {
      if (vid.url.trim()) {
        content.push({
          type: 'video_url',
          video_url: { url: vid.url.trim() },
          role: vid.role
        });
      }
    });

    refAudios.forEach(aud => {
      if (aud.url.trim()) {
        content.push({
          type: 'audio_url',
          audio_url: { url: aud.url.trim() },
          role: aud.role
        });
      }
    });

    const body: any = {
      model,
      content,
      generate_audio: generateAudio,
      ratio,
      resolution,
      duration,
      watermark
    };

    if (webSearch) {
      body.tools = [{ type: 'web_search' }];
    }

    return body;
  };

  const requestBody = useMemo(() => buildRequestBody(), [model, prompt, refImages, refVideos, refAudios, generateAudio, ratio, resolution, duration, watermark, webSearch]);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await axios.post(
        '/api/v1/doubao/create',
        requestBody,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      setResponse(res.data);
      if (res.data.id) setTaskId(res.data.id);
    } catch (err: any) {
      setResponse(err.response?.data || err.message);
    }
    setLoading(false);
  };

  const handleGetResult = async () => {
    setLoading(true);
    try {
      const res = await axios.post(
        '/api/v1/doubao/get_result',
        { id: taskId },
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      setResponse(res.data);
    } catch (err: any) {
      setResponse(err.response?.data || err.message);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl shadow-sm">
        <h1 className="text-xl sm:text-2xl font-bold">API Playground</h1>
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={() => setShowDocs(!showDocs)}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {showDocs ? '📖 隐藏文档' : '📖 参数文档'}
          </button>
          <Link to="/dashboard" className="text-blue-600 hover:underline text-sm sm:text-base">Back to Dashboard</Link>
        </div>
      </div>

      {/* Docs Panel */}
      {showDocs && (
        <div className="bg-white p-6 rounded-xl shadow-sm text-sm text-gray-700 space-y-4 border border-blue-100">
          <h2 className="text-lg font-bold text-gray-800">📖 API 参数说明</h2>

          <div>
            <h3 className="font-semibold text-gray-800 mb-1">content（必选）</h3>
            <p className="text-gray-500 mb-2">输入给模型的信息，支持以下组合：</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
              {['文本', '文本（可选）+ 图片', '文本（可选）+ 视频', '文本（可选）+ 图片 + 音频', '文本（可选）+ 图片 + 视频', '文本（可选）+ 视频 + 音频', '文本（可选）+ 图片 + 视频 + 音频'].map(c => (
                <span key={c} className="bg-blue-50 text-blue-700 px-2 py-1 rounded">{c}</span>
              ))}
            </div>
          </div>

          <hr className="border-gray-100" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold text-gray-800 mb-1">📝 文本信息</h4>
              <ul className="text-xs text-gray-500 space-y-0.5 list-disc pl-4">
                <li>中文不超过 500 字，英文不超过 1000 词</li>
                <li>字数过多信息容易分散，模型可能忽略细节</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-gray-800 mb-1">🖼️ 图片信息</h4>
              <ul className="text-xs text-gray-500 space-y-0.5 list-disc pl-4">
                <li>格式：jpeg, png, webp, bmp, tiff, gif</li>
                <li>宽高比（宽/高）：(0.4, 2.5)</li>
                <li>宽高长度：300~6000px</li>
                <li>大小：单张 &lt; 30MB，请求体 &lt; 64MB</li>
                <li>首帧：1 张 | 首尾帧：2 张 | 多模态参考：1~9 张</li>
              </ul>
              <div className="mt-1.5">
                <p className="text-xs font-medium text-gray-600 mb-0.5">图片 role 取值：</p>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <p><code className="bg-gray-100 px-1 rounded">first_frame</code> — 首帧（图生视频-首帧，1张）</p>
                  <p><code className="bg-gray-100 px-1 rounded">last_frame</code> — 尾帧（图生视频-首尾帧，需配合 first_frame）</p>
                  <p><code className="bg-gray-100 px-1 rounded">reference_image</code> — 参考图（多模态参考，1~9张）</p>
                </div>
                <p className="text-xs text-amber-600 mt-1">⚠️ 首帧/首尾帧/多模态参考为 3 种互斥场景</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-gray-800 mb-1">🎬 视频信息</h4>
              <ul className="text-xs text-gray-500 space-y-0.5 list-disc pl-4">
                <li>仅 Seedance 2.0 & 2.0 fast 支持</li>
                <li>格式：mp4, mov</li>
                <li>分辨率：480p, 720p</li>
                <li>时长：[2, 15]s，最多 3 个，总时长 ≤ 15s</li>
                <li>宽高比（宽/高）：[0.4, 2.5]</li>
                <li>大小：单个 ≤ 50MB</li>
                <li>帧率：[24, 60] FPS</li>
                <li>role 仅支持 <code className="bg-gray-100 px-1 rounded">reference_video</code></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-gray-800 mb-1">🎵 音频信息</h4>
              <ul className="text-xs text-gray-500 space-y-0.5 list-disc pl-4">
                <li>仅 Seedance 2.0 & 2.0 fast 支持</li>
                <li>格式：wav, mp3</li>
                <li>时长：[2, 15]s，最多 3 段，总时长 ≤ 15s</li>
                <li>大小：单个 ≤ 15MB，请求体 ≤ 64MB</li>
                <li>不可单独输入，需至少包含 1 个参考视频或图片</li>
                <li>role 仅支持 <code className="bg-gray-100 px-1 rounded">reference_audio</code></li>
              </ul>
            </div>
          </div>

          <hr className="border-gray-100" />

          <div>
            <h4 className="font-semibold text-gray-800 mb-2">⚙️ 其他参数</h4>
            <div className="overflow-x-auto">
              <table className="text-xs w-full border-collapse min-w-[500px]">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-2 py-1.5 border border-gray-200 font-semibold">参数</th>
                    <th className="text-left px-2 py-1.5 border border-gray-200 font-semibold">类型</th>
                    <th className="text-left px-2 py-1.5 border border-gray-200 font-semibold">默认值</th>
                    <th className="text-left px-2 py-1.5 border border-gray-200 font-semibold">说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">generate_audio</td><td className="px-2 py-1.5 border border-gray-200">boolean</td><td className="px-2 py-1.5 border border-gray-200">true</td><td className="px-2 py-1.5 border border-gray-200">控制视频是否包含同步声音（人声/音效/BGM）</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">resolution</td><td className="px-2 py-1.5 border border-gray-200">string</td><td className="px-2 py-1.5 border border-gray-200">720p</td><td className="px-2 py-1.5 border border-gray-200">视频分辨率，支持 480p / 720p</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">ratio</td><td className="px-2 py-1.5 border border-gray-200">string</td><td className="px-2 py-1.5 border border-gray-200">adaptive</td><td className="px-2 py-1.5 border border-gray-200">宽高比：16:9, 4:3, 1:1, 3:4, 9:16, 21:9, adaptive</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">duration</td><td className="px-2 py-1.5 border border-gray-200">integer</td><td className="px-2 py-1.5 border border-gray-200">5</td><td className="px-2 py-1.5 border border-gray-200">视频时长 [4,15] 秒，-1 为模型自动选择</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">watermark</td><td className="px-2 py-1.5 border border-gray-200">boolean</td><td className="px-2 py-1.5 border border-gray-200">-</td><td className="px-2 py-1.5 border border-gray-200">是否添加水印</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">tools</td><td className="px-2 py-1.5 border border-gray-200">object[]</td><td className="px-2 py-1.5 border border-gray-200">-</td><td className="px-2 py-1.5 border border-gray-200">web_search 联网搜索工具，提升时效性</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-gray-800 mb-1">📐 宽高比对应像素值</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">720p</p>
                <div className="text-xs text-gray-500 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span>16:9 → 1280×720</span><span>4:3 → 1112×834</span>
                  <span>1:1 → 960×960</span><span>3:4 → 834×1112</span>
                  <span>9:16 → 720×1280</span><span>21:9 → 1470×630</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">480p</p>
                <div className="text-xs text-gray-500 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span>16:9 → 864×496</span><span>4:3 → 752×560</span>
                  <span>1:1 → 640×640</span><span>3:4 → 560×752</span>
                  <span>9:16 → 496×864</span><span>21:9 → 992×432</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Config Bar: API Key + Model + Parameters ── */}
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">🔑 API Key</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md font-mono text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              placeholder="sk-xxxxxxxx"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">🤖 Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md font-mono text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              placeholder="doubao-seedance-2-0-260128"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">📐 Ratio</label>
            <select
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all bg-white"
            >
              <option value="adaptive">adaptive</option>
              <option value="16:9">16:9</option>
              <option value="4:3">4:3</option>
              <option value="1:1">1:1</option>
              <option value="3:4">3:4</option>
              <option value="9:16">9:16</option>
              <option value="21:9">21:9</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">🖥️ Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all bg-white"
            >
              <option value="720p">720p</option>
              <option value="480p">480p</option>
            </select>
          </div>
        </div>
        {/* Second row: Duration + toggles */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">⏱️ Duration</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value) || 5)}
              min={-1}
              max={15}
              className="w-20 px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
            />
            <span className="text-xs text-gray-400">秒</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">🔊 Audio</label>
            <button
              type="button"
              onClick={() => setGenerateAudio(!generateAudio)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${generateAudio ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${generateAudio ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">💧 Watermark</label>
            <button
              type="button"
              onClick={() => setWatermark(!watermark)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${watermark ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${watermark ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">🔍 Web Search</label>
            <button
              type="button"
              onClick={() => setWebSearch(!webSearch)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${webSearch ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${webSearch ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Prompt & Reference Media (full width) ── */}
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm space-y-5">
        {/* Text Prompt */}
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">📝 Text Prompt（可选）</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-md h-28 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all resize-y"
            placeholder="描述期望生成的视频内容..."
          />
          <HelpText>中文不超过 500 字，英文不超过 1000 词。对话部分请置于双引号内以优化音频生成。</HelpText>
        </div>

        {/* Reference Sections */}
        <div className="border-t border-gray-100 pt-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Reference Media</h3>

          {/* Reference Images */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <span>🖼️</span> 图片 Images
                <span className="text-xs text-gray-400 font-normal">({refImages.length})</span>
              </label>
              <button type="button" onClick={addImage} className="text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium">+ Add</button>
            </div>
            <HelpText>支持 URL / Base64 / asset://ID。格式 jpeg/png/webp/bmp/tiff/gif，单张 &lt; 30MB，300~6000px。首帧/首尾帧/参考图为互斥场景。</HelpText>
            {refImages.map(item => (
              <div key={item.id} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={item.url}
                  onChange={(e) => updateUrl(setRefImages, item.id, e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all w-full"
                  placeholder="https://... 或 data:image/png;base64,... 或 asset://ID"
                />
                <div className="flex gap-2">
                  <select
                    value={item.role}
                    onChange={(e) => updateRole(setRefImages, item.id, e.target.value)}
                    className="flex-1 sm:flex-none px-2 py-1.5 border border-gray-200 rounded-md text-xs bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
                  >
                    <option value="reference_image">参考图</option>
                    <option value="first_frame">首帧</option>
                    <option value="last_frame">尾帧</option>
                  </select>
                  <button type="button" onClick={() => removeItem(setRefImages, item.id)} className="px-3 py-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors text-sm border border-gray-200 sm:border-transparent" title="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Reference Videos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <span>🎬</span> 视频 Videos
                <span className="text-xs text-gray-400 font-normal">({refVideos.length})</span>
              </label>
              <button type="button" onClick={addVideo} className="text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium">+ Add</button>
            </div>
            <HelpText>仅 Seedance 2.0 支持。格式 mp4/mov，480p/720p，[2,15]s，最多 3 个总时长 ≤ 15s，单个 ≤ 50MB，FPS [24,60]。</HelpText>
            {refVideos.map(item => (
              <div key={item.id} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={item.url}
                  onChange={(e) => updateUrl(setRefVideos, item.id, e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all w-full"
                  placeholder="https://... 或 asset://ID"
                />
                <div className="flex gap-2">
                  <span className="flex-1 sm:flex-none px-2 py-1.5 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-center whitespace-nowrap">reference_video</span>
                  <button type="button" onClick={() => removeItem(setRefVideos, item.id)} className="px-3 py-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors text-sm border border-gray-200 sm:border-transparent" title="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Reference Audio */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <span>🎵</span> 音频 Audio
                <span className="text-xs text-gray-400 font-normal">({refAudios.length})</span>
              </label>
              <button type="button" onClick={addAudio} className="text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium">+ Add</button>
            </div>
            <HelpText>仅 Seedance 2.0 支持。格式 wav/mp3，[2,15]s，最多 3 段总时长 ≤ 15s，单个 ≤ 15MB。不可单独输入，需至少包含 1 个参考视频或图片。</HelpText>
            {refAudios.map(item => (
              <div key={item.id} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={item.url}
                  onChange={(e) => updateUrl(setRefAudios, item.id, e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all w-full"
                  placeholder="https://... 或 data:audio/wav;base64,... 或 asset://ID"
                />
                <div className="flex gap-2">
                  <span className="flex-1 sm:flex-none px-2 py-1.5 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-center whitespace-nowrap">reference_audio</span>
                  <button type="button" onClick={() => removeItem(setRefAudios, item.id)} className="px-3 py-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors text-sm border border-gray-200 sm:border-transparent" title="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-gray-100">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium shadow-sm w-full sm:w-auto"
          >
            {loading ? 'Sending...' : '🚀 Create Video Task'}
          </button>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors text-sm font-medium w-full sm:w-auto text-center"
          >
            {showPreview ? 'Hide' : 'Show'} Request Preview
          </button>
        </div>

        {/* Request Preview */}
        {showPreview && (
          <div>
            <h3 className="text-sm font-medium mb-2 text-gray-500">Request Body Preview:</h3>
            <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-xs leading-relaxed max-h-80 overflow-y-auto">
              {JSON.stringify(requestBody, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* ── Results Area: Check Result + Response (side-by-side on desktop) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Check Result */}
        <div className="bg-white p-4 sm:p-5 rounded-xl shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Check Result</h3>
          <input
            type="text"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-md font-mono text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
            placeholder="Task ID"
          />
          <button
            onClick={handleGetResult}
            disabled={loading}
            className="w-full bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium shadow-sm"
          >
            {loading ? 'Polling...' : '📡 Get Result'}
          </button>
        </div>

        {/* Response */}
        <div className="bg-white p-4 sm:p-5 rounded-xl shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Response</h3>
          <pre className="bg-gray-50 p-3 rounded-lg overflow-x-auto text-xs text-gray-800 max-h-72 overflow-y-auto leading-relaxed">
            {response ? JSON.stringify(response, null, 2) : 'No response yet'}
          </pre>
        </div>
      </div>

      {/* ── Curl & Response Examples (side-by-side on desktop) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Curl Example */}
        <div className="bg-white p-4 sm:p-5 rounded-xl shadow-sm space-y-3">
          <button
            onClick={() => setShowCurl(!showCurl)}
            className="flex items-center justify-between w-full text-left"
          >
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">💻 Curl 示例</h3>
            <span className="text-xs text-gray-400">{showCurl ? '▲ 收起' : '▼ 展开'}</span>
          </button>
          {showCurl && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">创建任务 (create)</span>
                  <button
                    onClick={() => copyCurl(buildCurlCreate(requestBody))}
                    className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors"
                  >{curlCopied ? '✅ 已复制' : '📋 复制'}</button>
                </div>
                <pre className="bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed max-h-52 overflow-y-auto whitespace-pre-wrap">
                  {buildCurlCreate(requestBody)}
                </pre>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">查询结果 (get_result)</span>
                  <button
                    onClick={() => copyCurl(buildCurlGetResult())}
                    className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors"
                  >{curlCopied ? '✅ 已复制' : '📋 复制'}</button>
                </div>
                <pre className="bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
                  {buildCurlGetResult()}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Response Example */}
        <div className="bg-white p-4 sm:p-5 rounded-xl shadow-sm space-y-3">
          <button
            onClick={() => setShowResponseExample(!showResponseExample)}
            className="flex items-center justify-between w-full text-left"
          >
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">📄 返回示例</h3>
            <span className="text-xs text-gray-400">{showResponseExample ? '▲ 收起' : '▼ 展开'}</span>
          </button>
          {showResponseExample && (
            <div className="space-y-3">
              <div>
                <span className="text-xs font-medium text-gray-600 block mb-1">创建任务 /create 返回：</span>
                <pre className="bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(sampleCreateResponse, null, 2)}
                </pre>
              </div>
              <div>
                <span className="text-xs font-medium text-gray-600 block mb-1">查询结果 /get_result 返回：</span>
                <pre className="bg-gray-900 text-blue-300 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(sampleGetResultResponse, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Playground;
