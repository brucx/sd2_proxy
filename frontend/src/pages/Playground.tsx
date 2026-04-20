import { useState, useMemo, useCallback, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

interface RefItem {
  id: number;
  url: string;
  role: string;
}

interface AssetItem {
  Id: string;
  Name?: string;
  URL?: string;
  AssetType?: string;
  GroupId?: string;
  Status?: string;
  Error?: { Code?: string; Message?: string };
  ProjectName?: string;
  CreateTime?: string;
  UpdateTime?: string;
}

interface PublicAssetGroup {
  SID: string;
  Title: string;
  Description: string;
  Score?: number;
  Content?: any;
}

type AssetTab = 'list' | 'create' | 'public';

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

  const [response, setResponse] = useState<any>(null);
  const [taskId, setTaskId] = useState('');
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showCurl, setShowCurl] = useState(true);
  const [showResponseExample, setShowResponseExample] = useState(true);
  const [curlCopied, setCurlCopied] = useState(false);

  // ── Asset Panel State ──
  const [showAssets, setShowAssets] = useState(false);
  const [assetTab, setAssetTab] = useState<AssetTab>('list');
  const [assetList, setAssetList] = useState<AssetItem[]>([]);
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetPage, setAssetPage] = useState(1);
  const [assetTotal, setAssetTotal] = useState(0);
  const assetPageSize = 10;
  const [assetStatusFilter, setAssetStatusFilter] = useState<string[]>([]);
  // Create asset
  const [createUrl, setCreateUrl] = useState('');
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('Image');
  const [createAssetLoading, setCreateAssetLoading] = useState(false);
  const [createAssetResult, setCreateAssetResult] = useState<any>(null);
  // Query single asset
  const [queryAssetId, setQueryAssetId] = useState('');
  const [queryAssetResult, setQueryAssetResult] = useState<AssetItem | null>(null);
  const [queryAssetLoading, setQueryAssetLoading] = useState(false);
  // Public assets
  const [publicAssets, setPublicAssets] = useState<PublicAssetGroup[]>([]);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicPage, setPublicPage] = useState(1);
  const [publicTotal, setPublicTotal] = useState(0);
  const publicPageSize = 12;
  // Clipboard feedback
  const [assetCopiedId, setAssetCopiedId] = useState<string | null>(null);

  // ── Usage History (simple reconciliation view) ──
  interface HistoryItem {
    id: number;
    taskId: string | null;
    endpoint: string;
    status: string | null;
    videoDuration: number | null;
    videoQuality: string | null;
    hasVideoInput: boolean;
    taskDurationMs: number | null;
    costDisplay: string;
    createdAt: string;
    updatedAt: string;
  }
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  const fetchHistory = useCallback(async (opts?: { page?: number }) => {
    if (!apiKey) return;
    const page = opts?.page ?? historyPage;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await axios.get('/api/v1/playground/history', {
        headers: { Authorization: `Bearer ${apiKey}` },
        params: {
          page,
          pageSize: historyPageSize,
          ...(historyStartDate && { startDate: historyStartDate }),
          ...(historyEndDate && { endDate: historyEndDate }),
        },
      });
      setHistory(res.data.items || []);
      setHistoryTotal(res.data.total ?? 0);
      setHistoryPage(res.data.page ?? page);
    } catch (err: any) {
      setHistoryError(err.response?.data?.error || err.message || 'Failed to load history');
      setHistory([]);
      setHistoryTotal(0);
    }
    setHistoryLoading(false);
  }, [apiKey, historyPage, historyPageSize, historyStartDate, historyEndDate]);

  useEffect(() => {
    if (apiKey) fetchHistory({ page: historyPage });
    else {
      setHistory([]);
      setHistoryTotal(0);
      setHistoryError(null);
      setHistoryPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, historyPage, historyPageSize, historyStartDate, historyEndDate]);

  const exportHistoryCsv = useCallback(async () => {
    if (!apiKey) return;
    setExportLoading(true);
    try {
      const res = await axios.get('/api/v1/playground/history', {
        headers: { Authorization: `Bearer ${apiKey}` },
        params: {
          page: 1,
          pageSize: 1000,
          ...(historyStartDate && { startDate: historyStartDate }),
          ...(historyEndDate && { endDate: historyEndDate }),
        },
      });
      const rows: HistoryItem[] = res.data.items || [];
      const header = ['created_at', 'task_id', 'endpoint', 'status', 'video_quality', 'video_duration_s', 'has_video_input', 'task_duration_ms', 'cost_cny'];
      const esc = (v: any) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push([
          esc(new Date(r.createdAt).toISOString()),
          esc(r.taskId || ''),
          esc(r.endpoint),
          esc(r.status || ''),
          esc(r.videoQuality || ''),
          esc(r.videoDuration ?? ''),
          esc(r.hasVideoInput),
          esc(r.taskDurationMs ?? ''),
          esc(r.costDisplay),
        ].join(','));
      }
      const csv = '\uFEFF' + lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `playground-usage-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setHistoryError(err.response?.data?.error || err.message || 'Export failed');
    }
    setExportLoading(false);
  }, [apiKey, historyStartDate, historyEndDate]);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // ── Asset API helpers ──
  const assetApi = useCallback(async (path: string, body: any) => {
    return axios.post(`/api/v1/open${path}`, body, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }, [apiKey]);

  const fetchAssetList = useCallback(async (page = 1) => {
    if (!apiKey) return;
    setAssetLoading(true);
    try {
      const body: any = {
        Filter: {
          GroupType: 'AIGC',
          ...(assetStatusFilter.length > 0 ? { Statuses: assetStatusFilter } : {}),
        },
        PageNumber: page,
        PageSize: assetPageSize,
        SortBy: 'CreateTime',
        SortOrder: 'Desc',
      };
      const res = await assetApi('/ListAssets', body);
      const result = res.data?.Result || {};
      setAssetList(result.Items || []);
      setAssetTotal(result.TotalCount || 0);
      setAssetPage(result.PageNumber || page);
    } catch {
      setAssetList([]);
    }
    setAssetLoading(false);
  }, [apiKey, assetStatusFilter, assetApi]);

  const handleCreateAsset = useCallback(async () => {
    if (!createUrl.trim() || !apiKey) return;
    setCreateAssetLoading(true);
    setCreateAssetResult(null);
    try {
      const body: any = {
        URL: createUrl.trim(),
        AssetType: createType,
        ...(createName.trim() ? { Name: createName.trim() } : {}),
      };
      const res = await assetApi('/CreateAsset', body);
      const result = res.data?.Result || res.data || {};
      setCreateAssetResult(result);
      if (result.Id) {
        setCreateUrl('');
        setCreateName('');
        // Auto-refresh list
        fetchAssetList(1);
      }
    } catch (err: any) {
      setCreateAssetResult(err.response?.data || { error: 'Request failed' });
    }
    setCreateAssetLoading(false);
  }, [apiKey, createUrl, createType, createName, assetApi, fetchAssetList]);

  const handleQueryAsset = useCallback(async () => {
    if (!queryAssetId.trim() || !apiKey) return;
    setQueryAssetLoading(true);
    setQueryAssetResult(null);
    try {
      const res = await assetApi('/GetAsset', { Id: queryAssetId.trim() });
      const result = res.data?.Result || res.data || {};
      setQueryAssetResult(result);
    } catch (err: any) {
      setQueryAssetResult(err.response?.data || { error: 'Request failed' } as any);
    }
    setQueryAssetLoading(false);
  }, [apiKey, queryAssetId, assetApi]);

  const fetchPublicAssets = useCallback(async (page = 1) => {
    if (!apiKey) return;
    setPublicLoading(true);
    try {
      const body: any = {
        pageNum: page,
        pageSize: publicPageSize,
        sortBy: 'score',
        sortOrder: 'desc',
      };
      const res = await assetApi('/ListMediaAssetGroup', body);
      const result = res.data?.Result || res.data || {};
      const rawItems = result.Items || [];
      const formatted = rawItems.map((item: any) => item.AssetGroup || item);
      setPublicAssets(formatted);
      setPublicTotal(result.Total || result.TotalCount || 0);
      setPublicPage(result.PageNum || result.PageNumber || page);
    } catch {
      setPublicAssets([]);
    }
    setPublicLoading(false);
  }, [apiKey, assetApi]);

  // Auto-load asset list when panel opens
  useEffect(() => {
    if (showAssets && apiKey) {
      if (assetTab === 'list') fetchAssetList(1);
      if (assetTab === 'public') fetchPublicAssets(1);
    }
  }, [showAssets, assetTab]);

  // Insert asset://ID into the appropriate ref media input
  const addRefFromAsset = useCallback((assetId: string, assetType?: string) => {
    const url = `asset://${assetId}`;
    const entry: RefItem = { id: nextId++, url, role: '' };
    if (assetType === 'Image') {
      entry.role = 'reference_image';
      setRefImages(prev => [...prev, entry]);
    } else if (assetType === 'Video') {
      entry.role = 'reference_video';
      setRefVideos(prev => [...prev, entry]);
    } else if (assetType === 'Audio') {
      entry.role = 'reference_audio';
      setRefAudios(prev => [...prev, entry]);
    } else {
      // Default to image if type unknown
      entry.role = 'reference_image';
      setRefImages(prev => [...prev, entry]);
    }
  }, []);

  const copyAssetId = useCallback(async (id: string) => {
    const text = `asset://${id}`;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setAssetCopiedId(id);
    setTimeout(() => setAssetCopiedId(null), 1500);
  }, []);

  // ── Asset Badge helpers ──
  const assetStatusBadge = (status?: string) => {
    const map: Record<string, string> = {
      Active: 'bg-green-100 text-green-700',
      Processing: 'bg-yellow-100 text-yellow-700',
      Failed: 'bg-red-100 text-red-600',
    };
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status || ''] || 'bg-gray-100 text-gray-600'}`}>
        {status || 'Unknown'}
      </span>
    );
  };

  const assetTypeBadge = (type?: string) => {
    const map: Record<string, string> = {
      Image: 'bg-blue-100 text-blue-700',
      Video: 'bg-purple-100 text-purple-700',
      Audio: 'bg-orange-100 text-orange-700',
    };
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[type || ''] || 'bg-gray-100 text-gray-600'}`}>
        {type || 'N/A'}
      </span>
    );
  };

  const buildCurlCreate = (body: any) => {
    const key = apiKey || 'YOUR_API_KEY';
    return `curl -X POST '${baseUrl}/api/v3/contents/generations/tasks' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${key}' \\
  -d '${JSON.stringify(body, null, 2)}'`;
  };

  const buildCurlGetResult = () => {
    const key = apiKey || 'YOUR_API_KEY';
    const tid = taskId || 'cgt-YYYYMMDDHHMMSS-xxxxx';
    return `curl -X GET '${baseUrl}/api/v3/contents/generations/tasks/${tid}' \\
  -H 'Authorization: Bearer ${key}'`;
  };

  const buildCurlCancel = () => {
    const key = apiKey || 'YOUR_API_KEY';
    const tid = taskId || 'cgt-YYYYMMDDHHMMSS-xxxxx';
    return `curl -X DELETE '${baseUrl}/api/v3/contents/generations/tasks/${tid}' \\
  -H 'Authorization: Bearer ${key}'`;
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
    id: "cgt-20260418112930-j7ule",
    model: "doubao-seedance-2-0-260128",
    status: "queued",
    error: null
  };

  const sampleGetResultResponse = {
    id: "cgt-20260418112930-j7ule",
    model: "doubao-seedance-2-0-260128",
    status: "succeeded",
    error: null,
    created_at: 1776511770,
    updated_at: 1776511897,
    content: {
      video_url: "https://.../xxx.mp4"
    },
    seed: 25265,
    resolution: "720p",
    ratio: "16:9",
    duration: 5,
    framespersecond: 24,
    generate_audio: true,
    service_tier: "default",
    execution_expires_after: 172800,
    usage: {
      completion_tokens: 108900,
      total_tokens: 108900
    }
  };

  const sampleCancelResponse = 'HTTP 204 No Content';

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
      duration
    };

    return body;
  };

  const requestBody = useMemo(() => buildRequestBody(), [model, prompt, refImages, refVideos, refAudios, generateAudio, ratio, resolution, duration]);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await axios.post(
        '/api/v3/contents/generations/tasks',
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
    if (!taskId.trim()) return;
    setLoading(true);
    try {
      const res = await axios.get(
        `/api/v3/contents/generations/tasks/${taskId.trim()}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      setResponse(res.data);
    } catch (err: any) {
      setResponse(err.response?.data || err.message);
    }
    setLoading(false);
  };

  const handleCancel = async () => {
    if (!taskId.trim()) return;
    setCancelLoading(true);
    try {
      const res = await axios.delete(
        `/api/v3/contents/generations/tasks/${taskId.trim()}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      setResponse(res.status === 204 ? { note: 'Task cancelled / record deleted (204 No Content)' } : res.data);
    } catch (err: any) {
      setResponse(err.response?.data || err.message);
    }
    setCancelLoading(false);
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
          <Link to="/docs" className="text-emerald-600 hover:underline text-sm sm:text-base">API Docs</Link>
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
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">resolution</td><td className="px-2 py-1.5 border border-gray-200">string</td><td className="px-2 py-1.5 border border-gray-200">720p</td><td className="px-2 py-1.5 border border-gray-200">视频分辨率，支持 480p / 720p / 1080p（1080p 仅标准模型支持）</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">ratio</td><td className="px-2 py-1.5 border border-gray-200">string</td><td className="px-2 py-1.5 border border-gray-200">adaptive</td><td className="px-2 py-1.5 border border-gray-200">宽高比：16:9, 4:3, 1:1, 3:4, 9:16, 21:9, adaptive</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">duration</td><td className="px-2 py-1.5 border border-gray-200">integer</td><td className="px-2 py-1.5 border border-gray-200">5</td><td className="px-2 py-1.5 border border-gray-200">视频时长 [4,15] 秒，或 -1（智能时长，由模型自主选择）</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">watermark</td><td className="px-2 py-1.5 border border-gray-200">boolean</td><td className="px-2 py-1.5 border border-gray-200">-</td><td className="px-2 py-1.5 border border-gray-200">是否添加水印</td></tr>
                  <tr><td className="px-2 py-1.5 border border-gray-200 font-mono">tools</td><td className="px-2 py-1.5 border border-gray-200">object[]</td><td className="px-2 py-1.5 border border-gray-200">-</td><td className="px-2 py-1.5 border border-gray-200">web_search 联网搜索工具，提升时效性</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-gray-800 mb-1">📐 宽高比对应像素值</h4>
            <div className="overflow-x-auto">
              <table className="text-xs w-full border-collapse min-w-[420px]">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-2 py-1.5 border border-gray-200 font-semibold">宽高比</th>
                    <th className="text-left px-2 py-1.5 border border-gray-200 font-semibold">480p</th>
                    <th className="text-left px-2 py-1.5 border border-gray-200 font-semibold">720p</th>
                    <th className="text-left px-2 py-1.5 border border-gray-200 font-semibold">1080p</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="px-2 py-1 border border-gray-200">16:9</td><td className="px-2 py-1 border border-gray-200">864×496</td><td className="px-2 py-1 border border-gray-200">1280×720</td><td className="px-2 py-1 border border-gray-200">1920×1080</td></tr>
                  <tr><td className="px-2 py-1 border border-gray-200">4:3</td><td className="px-2 py-1 border border-gray-200">752×560</td><td className="px-2 py-1 border border-gray-200">1112×834</td><td className="px-2 py-1 border border-gray-200">1664×1248</td></tr>
                  <tr><td className="px-2 py-1 border border-gray-200">1:1</td><td className="px-2 py-1 border border-gray-200">640×640</td><td className="px-2 py-1 border border-gray-200">960×960</td><td className="px-2 py-1 border border-gray-200">1440×1440</td></tr>
                  <tr><td className="px-2 py-1 border border-gray-200">3:4</td><td className="px-2 py-1 border border-gray-200">560×752</td><td className="px-2 py-1 border border-gray-200">834×1112</td><td className="px-2 py-1 border border-gray-200">1248×1664</td></tr>
                  <tr><td className="px-2 py-1 border border-gray-200">9:16</td><td className="px-2 py-1 border border-gray-200">496×864</td><td className="px-2 py-1 border border-gray-200">720×1280</td><td className="px-2 py-1 border border-gray-200">1080×1920</td></tr>
                  <tr><td className="px-2 py-1 border border-gray-200">21:9</td><td className="px-2 py-1 border border-gray-200">992×432</td><td className="px-2 py-1 border border-gray-200">1470×630</td><td className="px-2 py-1 border border-gray-200">2206×946</td></tr>
                </tbody>
              </table>
              <p className="text-xs text-amber-600 mt-1">⚠️ 1080p 仅标准模型支持，fast 模型不支持</p>
            </div>
          </div>
        </div>
      )}

      {/* ── API Key (required, prominent) ── */}
      <div className={`bg-white p-4 sm:p-6 rounded-xl shadow-sm border-2 ${apiKey ? 'border-transparent' : 'border-blue-200'}`}>
        <label htmlFor="api-key-input" className="flex items-center gap-1.5 text-base font-semibold mb-2 text-gray-800">
          <span>🔑</span>
          <span>API Key</span>
          <span className="text-red-500" aria-hidden="true">*</span>
          <span className="sr-only">（必填）</span>
        </label>
        <input
          id="api-key-input"
          type="password"
          required
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-base focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
          placeholder="sk-xxxxxxxx"
          autoComplete="off"
        />
        {!apiKey && (
          <p className="mt-2 text-xs text-blue-600">请填入 API Key 以使用 Playground、管理素材并发起请求。</p>
        )}
      </div>

      {/* ── Asset Management Panel (collapsible) ── */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => setShowAssets(!showAssets)}
          className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📦</span>
            <h2 className="text-sm sm:text-base font-semibold text-gray-800">我的素材 (Assets)</h2>
            {apiKey && <span className="text-xs text-gray-400">· 由当前 API Key 管理</span>}
          </div>
          <span className="text-xs text-gray-400">{showAssets ? '▲ 收起' : '▼ 展开'}</span>
        </button>

        {showAssets && (
          <div className="px-4 sm:px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
            {/* API Key required notice */}
            {!apiKey ? (
              <div className="text-center py-6 text-gray-400 text-sm">
                <p>🔑 请先在上方填入 API Key 以查看和管理素材</p>
              </div>
            ) : (
              <>
                {/* Tab Navigation */}
                <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
                  {([
                    { key: 'list' as AssetTab, label: '已上传素材', icon: '📦' },
                    { key: 'create' as AssetTab, label: '提交素材', icon: '➕' },
                    { key: 'public' as AssetTab, label: '公共素材库', icon: '🌐' },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setAssetTab(tab.key)}
                      className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                        assetTab === tab.key
                          ? 'bg-white text-gray-800 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </div>

                {/* ═══ Tab: My Assets List ═══ */}
                {assetTab === 'list' && (
                  <div className="space-y-3">
                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-gray-600">状态筛选:</span>
                      {['Active', 'Processing', 'Failed'].map(s => (
                        <label key={s} className="flex items-center gap-1 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={assetStatusFilter.includes(s)}
                            onChange={(e) => {
                              if (e.target.checked) setAssetStatusFilter(prev => [...prev, s]);
                              else setAssetStatusFilter(prev => prev.filter(x => x !== s));
                            }}
                            className="rounded"
                          />
                          {s}
                        </label>
                      ))}
                      <button
                        onClick={() => fetchAssetList(1)}
                        disabled={assetLoading}
                        className="ml-auto px-3 py-1 bg-blue-600 text-white rounded-md text-xs hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {assetLoading ? '加载中...' : '🔍 查询'}
                      </button>
                    </div>

                    {/* Query single asset */}
                    <div className="flex flex-col sm:flex-row gap-2 p-2.5 bg-gray-50 rounded-lg">
                      <input
                        type="text"
                        value={queryAssetId}
                        onChange={(e) => setQueryAssetId(e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-xs font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                        placeholder="输入 Asset ID 查询详情..."
                      />
                      <button
                        onClick={handleQueryAsset}
                        disabled={queryAssetLoading}
                        className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {queryAssetLoading ? '查询中...' : '查询详情'}
                      </button>
                    </div>

                    {/* Query Result */}
                    {queryAssetResult && (
                      <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-800">查询结果</span>
                          <button onClick={() => setQueryAssetResult(null)} className="text-xs text-gray-400 hover:text-gray-600">✕ 关闭</button>
                        </div>
                        <pre className="text-xs bg-white p-2 rounded overflow-x-auto max-h-40 overflow-y-auto">
                          {JSON.stringify(queryAssetResult, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Assets Table (desktop) */}
                    <div className="overflow-x-auto hidden md:block">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b bg-gray-50">
                            <th className="p-2 font-semibold text-gray-600">Asset ID</th>
                            <th className="p-2 font-semibold text-gray-600">名称</th>
                            <th className="p-2 font-semibold text-gray-600">类型</th>
                            <th className="p-2 font-semibold text-gray-600">状态</th>
                            <th className="p-2 font-semibold text-gray-600">创建时间</th>
                            <th className="p-2 font-semibold text-gray-600">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assetList.length === 0 && !assetLoading && (
                            <tr><td colSpan={6} className="p-4 text-center text-gray-400 text-xs">暂无素材</td></tr>
                          )}
                          {assetList.map(a => (
                            <tr key={a.Id} className="border-b hover:bg-gray-50 transition-colors">
                              <td className="p-2 font-mono text-xs max-w-[160px] truncate" title={a.Id}>{a.Id}</td>
                              <td className="p-2 text-xs">{a.Name || '-'}</td>
                              <td className="p-2">{assetTypeBadge(a.AssetType)}</td>
                              <td className="p-2">{assetStatusBadge(a.Status)}</td>
                              <td className="p-2 text-xs text-gray-500">{a.CreateTime || '-'}</td>
                              <td className="p-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <button
                                    onClick={() => copyAssetId(a.Id)}
                                    className="text-xs text-gray-500 hover:text-blue-600 transition-colors whitespace-nowrap"
                                    title="复制 asset:// 引用"
                                  >
                                    {assetCopiedId === a.Id ? '✅ 已复制' : '📋 复制'}
                                  </button>
                                  <button
                                    onClick={() => addRefFromAsset(a.Id, a.AssetType)}
                                    className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors font-medium whitespace-nowrap"
                                    title="将 asset://ID 添加到下方参考素材"
                                  >
                                    📎 使用
                                  </button>
                                  {a.URL && (
                                    <a href={a.URL} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                                      👁️ 预览
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Assets Cards (mobile) */}
                    <div className="md:hidden grid gap-2">
                      {assetList.length === 0 && !assetLoading && (
                        <p className="text-center text-gray-400 text-xs py-4">暂无素材</p>
                      )}
                      {assetList.map(a => (
                        <div key={a.Id} className="border border-gray-100 rounded-lg p-2.5 bg-gray-50 space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="font-mono text-xs text-gray-700 truncate max-w-[180px]" title={a.Id}>{a.Id}</span>
                            <div className="flex gap-1">{assetTypeBadge(a.AssetType)} {assetStatusBadge(a.Status)}</div>
                          </div>
                          {a.Name && <p className="text-xs text-gray-600">{a.Name}</p>}
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-400">{a.CreateTime || '-'}</span>
                            <div className="flex gap-2">
                              <button onClick={() => copyAssetId(a.Id)} className="text-xs text-gray-500">📋</button>
                              <button onClick={() => addRefFromAsset(a.Id, a.AssetType)} className="text-xs text-indigo-600 font-medium">📎 使用</button>
                              {a.URL && <a href={a.URL} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600">👁️</a>}
                            </div>
                          </div>
                          {a.Error && <p className="text-xs text-red-500">❌ {a.Error.Message || a.Error.Code}</p>}
                        </div>
                      ))}
                    </div>

                    {/* Pagination */}
                    {assetTotal > assetPageSize && (
                      <div className="flex items-center justify-center gap-3 pt-1">
                        <button
                          onClick={() => fetchAssetList(assetPage - 1)}
                          disabled={assetPage <= 1 || assetLoading}
                          className="px-2.5 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                        >
                          ← 上一页
                        </button>
                        <span className="text-xs text-gray-500">第 {assetPage} 页 / 共 {Math.ceil(assetTotal / assetPageSize)} 页</span>
                        <button
                          onClick={() => fetchAssetList(assetPage + 1)}
                          disabled={assetPage >= Math.ceil(assetTotal / assetPageSize) || assetLoading}
                          className="px-2.5 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                        >
                          下一页 →
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ Tab: Create Asset ═══ */}
                {assetTab === 'create' && (
                  <div className="space-y-3 max-w-2xl">
                    <div className="p-2.5 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 space-y-0.5">
                      <p className="font-semibold">📋 素材提交说明</p>
                      <p>提交素材后需经过预处理，状态为 Processing → Active 即可使用。</p>
                      <p>使用方式：在视频生成请求中通过 <code className="bg-amber-100 px-1 rounded">asset://&lt;ASSET_ID&gt;</code> 引用。</p>
                    </div>

                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">素材 URL（必填）</label>
                        <input
                          type="text"
                          value={createUrl}
                          onChange={(e) => setCreateUrl(e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-md text-xs font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
                          placeholder="https://example.com/asset.jpg"
                        />
                        <p className="text-xs text-gray-400 mt-0.5">仅支持公共可访问的 URL</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">素材类型（必填）</label>
                          <select
                            value={createType}
                            onChange={(e) => setCreateType(e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-md text-xs bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                          >
                            <option value="Image">🖼️ Image</option>
                            <option value="Video">🎬 Video</option>
                            <option value="Audio">🎵 Audio</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">名称（可选）</label>
                          <input
                            type="text"
                            value={createName}
                            onChange={(e) => setCreateName(e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-md text-xs focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                            placeholder="素材名称（上限 64 字符）"
                            maxLength={64}
                          />
                        </div>
                      </div>

                      <button
                        onClick={handleCreateAsset}
                        disabled={createAssetLoading || !createUrl.trim()}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-xs font-medium shadow-sm"
                      >
                        {createAssetLoading ? '提交中...' : '🚀 提交素材'}
                      </button>
                    </div>

                    {/* Requirements quick ref */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="p-2.5 bg-blue-50 rounded-lg">
                        <p className="font-semibold text-blue-700 mb-0.5">🖼️ 图像</p>
                        <ul className="text-blue-600 space-y-0.5 list-disc pl-3">
                          <li>格式: jpeg, png, webp, bmp, tiff, gif</li>
                          <li>尺寸: 300~6000px，≤ 30MB</li>
                        </ul>
                      </div>
                      <div className="p-2.5 bg-purple-50 rounded-lg">
                        <p className="font-semibold text-purple-700 mb-0.5">🎬 视频</p>
                        <ul className="text-purple-600 space-y-0.5 list-disc pl-3">
                          <li>格式: mp4, mov</li>
                          <li>时长: 2~15s，≤ 50MB</li>
                        </ul>
                      </div>
                      <div className="p-2.5 bg-orange-50 rounded-lg">
                        <p className="font-semibold text-orange-700 mb-0.5">🎵 音频</p>
                        <ul className="text-orange-600 space-y-0.5 list-disc pl-3">
                          <li>格式: wav, mp3</li>
                          <li>时长: 2~15s，≤ 15MB</li>
                        </ul>
                      </div>
                    </div>

                    {/* Create Result */}
                    {createAssetResult && (
                      <div className={`p-3 rounded-lg border ${createAssetResult.Id ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                        <p className={`text-xs font-semibold ${createAssetResult.Id ? 'text-green-700' : 'text-red-700'}`}>
                          {createAssetResult.Id ? '✅ 提交成功' : '❌ 提交失败'}
                        </p>
                        {createAssetResult.Id && (
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <code className="text-xs bg-white px-2 py-0.5 rounded border font-mono">{createAssetResult.Id}</code>
                            <button
                              onClick={() => copyAssetId(createAssetResult.Id)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              📋 复制
                            </button>
                            <button
                              onClick={() => { setQueryAssetId(createAssetResult.Id); setAssetTab('list'); }}
                              className="text-xs text-indigo-600 hover:underline"
                            >
                              🔍 查看状态
                            </button>
                            <button
                              onClick={() => addRefFromAsset(createAssetResult.Id, createType)}
                              className="text-xs text-green-600 hover:underline font-medium"
                            >
                              📎 使用
                            </button>
                          </div>
                        )}
                        {!createAssetResult.Id && (
                          <pre className="text-xs mt-1 text-red-600 overflow-x-auto">{JSON.stringify(createAssetResult, null, 2)}</pre>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ Tab: Public Assets ═══ */}
                {assetTab === 'public' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-600">平台提供的虚拟人像素材库，可直接用于视频生成。</p>
                      <button
                        onClick={() => fetchPublicAssets(1)}
                        disabled={publicLoading}
                        className="px-3 py-1 bg-blue-600 text-white rounded-md text-xs hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {publicLoading ? '加载中...' : '🔄 刷新'}
                      </button>
                    </div>

                    {/* Public Assets Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {publicAssets.length === 0 && !publicLoading && (
                        <p className="col-span-full text-center text-gray-400 text-xs py-6">暂无公共素材</p>
                      )}
                      {publicAssets.map(group => (
                        <div key={group.SID} className="border border-gray-100 rounded-lg p-2.5 hover:shadow-md transition-shadow bg-white">
                          <div className="flex justify-between items-start mb-1">
                            <h4 className="text-xs font-medium text-gray-800 line-clamp-1" title={group.Title || group.SID}>{group.Title || group.SID}</h4>
                            {group.Score !== undefined && (
                              <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded whitespace-nowrap ml-2">
                                ⭐ {group.Score.toFixed(1)}
                              </span>
                            )}
                          </div>
                          {/* Thumbnail */}
                          {group.Content?.Image?.[0]?.URL && (
                            <div className="mb-1.5 rounded-md overflow-hidden h-32 bg-gray-100 flex items-center justify-center">
                              <img
                                src={group.Content.Image[0].URL}
                                alt={group.Title || 'Thumbnail'}
                                className="w-full h-full object-cover object-center hover:scale-105 transition-transform duration-300"
                                loading="lazy"
                              />
                            </div>
                          )}
                          {!group.Content?.Image?.[0]?.URL && group.Content?.Video?.[0]?.URL && (
                            <div className="mb-1.5 rounded-md overflow-hidden h-32 bg-gray-100">
                              <video src={group.Content.Video[0].URL} className="w-full h-full object-cover" controls preload="metadata" />
                            </div>
                          )}
                          {group.Description && (
                            <p className="text-xs text-gray-500 line-clamp-2 mb-1.5" title={group.Description}>{group.Description}</p>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400 font-mono truncate max-w-[120px]" title={group.SID}>{group.SID}</span>
                            <button
                              onClick={() => { navigator.clipboard.writeText(group.SID); }}
                              className="text-xs text-gray-500 hover:text-blue-600 transition-colors"
                              title="复制 SID"
                            >
                              📋 复制ID
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Public Pagination */}
                    {publicTotal > publicPageSize && (
                      <div className="flex items-center justify-center gap-3 pt-1">
                        <button
                          onClick={() => fetchPublicAssets(publicPage - 1)}
                          disabled={publicPage <= 1 || publicLoading}
                          className="px-2.5 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                        >
                          ← 上一页
                        </button>
                        <span className="text-xs text-gray-500">第 {publicPage} 页 / 共 {Math.ceil(publicTotal / publicPageSize)} 页</span>
                        <button
                          onClick={() => fetchPublicAssets(publicPage + 1)}
                          disabled={publicPage >= Math.ceil(publicTotal / publicPageSize) || publicLoading}
                          className="px-2.5 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                        >
                          下一页 →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Prompt & Reference Media (full width) ── */}
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm space-y-5">
        {/* Parameters */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">🤖 Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all bg-white"
              >
                <option value="doubao-seedance-2-0-260128">doubao-seedance-2-0-260128 (Standard)</option>
                <option value="doubao-seedance-2-0-fast-260128">doubao-seedance-2-0-fast-260128 (Fast)</option>
              </select>
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
                <option value="1080p">1080p</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">⏱️ Duration</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => { const v = parseInt(e.target.value); setDuration(isNaN(v) ? 5 : (v === -1 ? -1 : Math.min(15, Math.max(4, v)))); }}
                min={-1}
                max={15}
                className="w-20 px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              />
              <span className="text-xs text-gray-400">{duration === -1 ? '智能' : '秒'}</span>
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
          </div>
        </div>

        {/* Text Prompt */}
        <div className="border-t border-gray-100 pt-5">
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
          <p className="text-xs text-amber-600">⚠️ 同一任务 ID 查询间隔需不少于 3 秒</p>
          <input
            type="text"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-md font-mono text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
            placeholder="cgt-YYYYMMDDHHMMSS-xxxxx"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={handleGetResult}
              disabled={loading || !taskId.trim()}
              className="bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium shadow-sm"
            >
              {loading ? 'Polling...' : '📡 Get Result'}
            </button>
            <button
              onClick={handleCancel}
              disabled={cancelLoading || !taskId.trim()}
              className="bg-red-500 text-white px-4 py-2.5 rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors font-medium shadow-sm"
            >
              {cancelLoading ? 'Cancelling...' : '🗑️ Cancel / Delete'}
            </button>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong>Cancel</strong>：任务处于 queued/running 时会取消；已终结（succeeded/failed/expired）则删除记录；返回 204 No Content。
          </p>
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
                  <span className="text-xs font-medium text-gray-600">查询结果 (GET /tasks/:id)</span>
                  <button
                    onClick={() => copyCurl(buildCurlGetResult())}
                    className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors"
                  >{curlCopied ? '✅ 已复制' : '📋 复制'}</button>
                </div>
                <pre className="bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
                  {buildCurlGetResult()}
                </pre>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">取消/删除任务 (DELETE /tasks/:id)</span>
                  <button
                    onClick={() => copyCurl(buildCurlCancel())}
                    className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors"
                  >{curlCopied ? '✅ 已复制' : '📋 复制'}</button>
                </div>
                <pre className="bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
                  {buildCurlCancel()}
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
                <span className="text-xs font-medium text-gray-600 block mb-1">创建任务 /tasks 返回：</span>
                <pre className="bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(sampleCreateResponse, null, 2)}
                </pre>
              </div>
              <div>
                <span className="text-xs font-medium text-gray-600 block mb-1">查询结果 /tasks/:id 返回：</span>
                <pre className="bg-gray-900 text-blue-300 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(sampleGetResultResponse, null, 2)}
                </pre>
              </div>
              <div>
                <span className="text-xs font-medium text-gray-600 block mb-1">取消/删除任务 DELETE /tasks/:id 返回：</span>
                <pre className="bg-gray-900 text-amber-300 p-3 rounded-lg overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
                  {sampleCancelResponse}
                </pre>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  status 枚举：<code className="bg-gray-100 px-1 rounded">queued</code> /{' '}
                  <code className="bg-gray-100 px-1 rounded">running</code> /{' '}
                  <code className="bg-gray-100 px-1 rounded">succeeded</code> /{' '}
                  <code className="bg-gray-100 px-1 rounded">failed</code> /{' '}
                  <code className="bg-gray-100 px-1 rounded">cancelled</code> /{' '}
                  <code className="bg-gray-100 px-1 rounded">expired</code>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Usage History (reconciliation) ── */}
      <div className="bg-white p-4 sm:p-5 rounded-xl shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <h3 className="text-sm sm:text-base font-semibold text-gray-800">使用历史 / Usage History</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchHistory({ page: historyPage })}
              disabled={!apiKey || historyLoading}
              className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {historyLoading ? '加载中…' : '🔄 刷新'}
            </button>
            <button
              onClick={exportHistoryCsv}
              disabled={!apiKey || exportLoading}
              className="text-xs px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >
              {exportLoading ? '导出中…' : '⬇ 导出 CSV'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">起始日期</label>
            <input
              type="date"
              value={historyStartDate}
              onChange={(e) => { setHistoryPage(1); setHistoryStartDate(e.target.value); }}
              className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              disabled={!apiKey}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">结束日期</label>
            <input
              type="date"
              value={historyEndDate}
              onChange={(e) => { setHistoryPage(1); setHistoryEndDate(e.target.value); }}
              className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              disabled={!apiKey}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">每页</label>
            <select
              value={historyPageSize}
              onChange={(e) => { setHistoryPage(1); setHistoryPageSize(parseInt(e.target.value)); }}
              className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all bg-white"
              disabled={!apiKey}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          {(historyStartDate || historyEndDate) && (
            <button
              onClick={() => { setHistoryPage(1); setHistoryStartDate(''); setHistoryEndDate(''); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2 pb-1.5"
            >
              清空筛选
            </button>
          )}
        </div>

        {!apiKey ? (
          <p className="text-sm text-gray-400 text-center py-6">请在上方填入 API Key 查看使用历史</p>
        ) : historyError ? (
          <p className="text-sm text-red-500 py-4">⚠️ {historyError}</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">{historyLoading ? '加载中…' : '暂无记录'}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">时间</th>
                    <th className="py-2 pr-3 font-medium">Task ID</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">规格</th>
                    <th className="py-2 pr-3 font-medium text-right">金额 (CNY)</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(row => {
                    const time = new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false });
                    const spec = [
                      row.videoQuality || null,
                      row.videoDuration ? `${row.videoDuration}s` : null,
                      row.hasVideoInput ? 'i2v/ref' : 't2v',
                    ].filter(Boolean).join(' · ');
                    const statusColor =
                      row.status === 'succeeded' ? 'text-emerald-600' :
                      row.status === 'failed' || row.status === 'rejected' ? 'text-red-500' :
                      row.status === 'cancelled' || row.status === 'expired' ? 'text-gray-400' :
                      'text-blue-500';
                    return (
                      <tr key={row.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{time}</td>
                        <td className="py-2 pr-3 font-mono text-gray-700 truncate max-w-[180px]" title={row.taskId || ''}>
                          {row.taskId || '-'}
                        </td>
                        <td className={`py-2 pr-3 font-medium ${statusColor}`}>{row.status || '-'}</td>
                        <td className="py-2 pr-3 text-gray-500">{spec || '-'}</td>
                        <td className="py-2 pr-3 text-right font-mono text-gray-800">¥ {row.costDisplay}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
              <p className="text-xs text-gray-400">
                共 {historyTotal} 条 · 第 {historyPage} / {Math.max(1, Math.ceil(historyTotal / historyPageSize))} 页
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                  disabled={historyLoading || historyPage <= 1}
                  className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  上一页
                </button>
                <button
                  onClick={() => setHistoryPage(p => p + 1)}
                  disabled={historyLoading || historyPage >= Math.ceil(historyTotal / historyPageSize)}
                  className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Playground;
