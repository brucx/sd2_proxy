import { useState, useEffect } from 'react';
import { api } from '../api';

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
  Metadata?: any;
  Score?: number;
  Content?: any;
}

type TabType = 'my-assets' | 'create' | 'public';

export default function AssetManagement() {
  const [activeTab, setActiveTab] = useState<TabType>('my-assets');

  // ── My Assets State ──
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetPage, setAssetPage] = useState(1);
  const [assetTotal, setAssetTotal] = useState(0);
  const assetPageSize = 10;
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  // ── Create Asset State ──
  const [createUrl, setCreateUrl] = useState('');
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('Image');
  const [createLoading, setCreateLoading] = useState(false);
  const [createResult, setCreateResult] = useState<any>(null);

  // ── Query Asset State ──
  const [queryId, setQueryId] = useState('');
  const [queryResult, setQueryResult] = useState<AssetItem | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  // ── Public Assets State ──
  const [publicAssets, setPublicAssets] = useState<PublicAssetGroup[]>([]);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicPage, setPublicPage] = useState(1);
  const [publicTotal, setPublicTotal] = useState(0);
  const publicPageSize = 12;

  // ── Fetch My Assets ──
  const fetchAssets = async (page = assetPage) => {
    setAssetsLoading(true);
    try {
      const body: any = {
        Filter: {
          GroupType: 'AIGC',
          ...(statusFilter.length > 0 ? { Statuses: statusFilter } : {}),
        },
        PageNumber: page,
        PageSize: assetPageSize,
        SortBy: 'CreateTime',
        SortOrder: 'Desc',
      };
      const res = await api.post('/admin/assets/list', body);
      const result = res.data?.Result || res.data || {};
      setAssets(result.Items || []);
      setAssetTotal(result.TotalCount || result.Total || 0);
      setAssetPage(result.PageNumber || result.PageNum || page);
    } catch (err: any) {
      console.error('ListAssets error:', err);
      setAssets([]);
    }
    setAssetsLoading(false);
  };

  // ── Create Asset ──
  const handleCreate = async () => {
    if (!createUrl.trim()) return;
    setCreateLoading(true);
    setCreateResult(null);
    try {
      const body: any = {
        URL: createUrl.trim(),
        AssetType: createType,
        ...(createName.trim() ? { Name: createName.trim() } : {}),
      };
      const res = await api.post('/admin/assets/create', body);
      const result = res.data?.Result || res.data || {};
      setCreateResult(result);
      if (result.Id) {
        setCreateUrl('');
        setCreateName('');
      }
    } catch (err: any) {
      setCreateResult(err.response?.data || { error: 'Request failed' });
    }
    setCreateLoading(false);
  };

  // ── Query Single Asset ──
  const handleQuery = async () => {
    if (!queryId.trim()) return;
    setQueryLoading(true);
    setQueryResult(null);
    try {
      const res = await api.post('/admin/assets/get', { Id: queryId.trim() });
      const result = res.data?.Result || res.data || {};
      setQueryResult(result);
    } catch (err: any) {
      setQueryResult(err.response?.data || { error: 'Request failed' } as any);
    }
    setQueryLoading(false);
  };

  // ── Fetch Public Assets ──
  const fetchPublicAssets = async (page = publicPage) => {
    setPublicLoading(true);
    try {
      const body: any = {
        pageNum: page,
        pageSize: publicPageSize,
        sortBy: 'score',
        sortOrder: 'desc',
      };
      const res = await api.post('/admin/assets/public', body);
      const result = res.data?.Result || res.data || {};
      const rawItems = result.Items || [];
      const formattedItems = rawItems.map((item: any) => item.AssetGroup || item);
      setPublicAssets(formattedItems);
      setPublicTotal(result.Total || result.TotalCount || 0);
      setPublicPage(result.PageNum || result.PageNumber || page);
    } catch (err: any) {
      console.error('ListMediaAssetGroup error:', err);
      setPublicAssets([]);
    }
    setPublicLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'my-assets') fetchAssets(1);
    if (activeTab === 'public') fetchPublicAssets(1);
  }, [activeTab]);

  const statusBadge = (status?: string) => {
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

  const typeBadge = (type?: string) => {
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

  const tabs: { key: TabType; label: string; icon: string }[] = [
    { key: 'my-assets', label: '已上传素材', icon: '📦' },
    { key: 'create', label: '提交素材', icon: '➕' },
    { key: 'public', label: '公共素材库', icon: '🌐' },
  ];

  return (
    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
      <h2 className="text-xl font-bold mb-4">🎬 素材管理 (Asset Management)</h2>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Tab: My Assets ═══ */}
      {activeTab === 'my-assets' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">状态筛选:</span>
            {['Active', 'Processing', 'Failed'].map(s => (
              <label key={s} className="flex items-center gap-1 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilter.includes(s)}
                  onChange={(e) => {
                    if (e.target.checked) setStatusFilter(prev => [...prev, s]);
                    else setStatusFilter(prev => prev.filter(x => x !== s));
                  }}
                  className="rounded"
                />
                {s}
              </label>
            ))}
            <button
              onClick={() => fetchAssets(1)}
              disabled={assetsLoading}
              className="ml-auto px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {assetsLoading ? '加载中...' : '🔍 查询'}
            </button>
          </div>

          {/* Query single asset */}
          <div className="flex flex-col sm:flex-row gap-2 p-3 bg-gray-50 rounded-lg">
            <input
              type="text"
              value={queryId}
              onChange={(e) => setQueryId(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
              placeholder="输入 Asset ID 查询详情..."
            />
            <button
              onClick={handleQuery}
              disabled={queryLoading}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {queryLoading ? '查询中...' : '查询详情'}
            </button>
          </div>

          {/* Query Result */}
          {queryResult && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-blue-800">查询结果</span>
                <button onClick={() => setQueryResult(null)} className="text-xs text-gray-400 hover:text-gray-600">✕ 关闭</button>
              </div>
              <pre className="text-xs bg-white p-2 rounded overflow-x-auto max-h-48 overflow-y-auto">
                {JSON.stringify(queryResult, null, 2)}
              </pre>
            </div>
          )}

          {/* Assets List - Desktop Table */}
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-2 text-xs font-semibold text-gray-600">Asset ID</th>
                  <th className="p-2 text-xs font-semibold text-gray-600">名称</th>
                  <th className="p-2 text-xs font-semibold text-gray-600">类型</th>
                  <th className="p-2 text-xs font-semibold text-gray-600">状态</th>
                  <th className="p-2 text-xs font-semibold text-gray-600">创建时间</th>
                  <th className="p-2 text-xs font-semibold text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 && !assetsLoading && (
                  <tr><td colSpan={6} className="p-4 text-center text-gray-400 text-sm">暂无素材</td></tr>
                )}
                {assets.map(a => (
                  <tr key={a.Id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="p-2 font-mono text-xs max-w-[180px] truncate" title={a.Id}>{a.Id}</td>
                    <td className="p-2 text-xs">{a.Name || '-'}</td>
                    <td className="p-2">{typeBadge(a.AssetType)}</td>
                    <td className="p-2">{statusBadge(a.Status)}</td>
                    <td className="p-2 text-xs text-gray-500">{a.CreateTime || '-'}</td>
                    <td className="p-2">
                      {a.URL && (
                        <a href={a.URL} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                          预览
                        </a>
                      )}
                      <button
                        onClick={() => { navigator.clipboard.writeText(`asset://${a.Id}`); }}
                        className="ml-2 text-xs text-gray-500 hover:text-blue-600"
                        title="复制 asset:// 引用"
                      >
                        📋 复制ID
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Assets List - Mobile Cards */}
          <div className="md:hidden grid gap-3">
            {assets.length === 0 && !assetsLoading && (
              <p className="text-center text-gray-400 text-sm py-4">暂无素材</p>
            )}
            {assets.map(a => (
              <div key={a.Id} className="border border-gray-100 rounded-lg p-3 bg-gray-50 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-xs text-gray-700 truncate max-w-[200px]" title={a.Id}>{a.Id}</span>
                  <div className="flex gap-1">{typeBadge(a.AssetType)} {statusBadge(a.Status)}</div>
                </div>
                {a.Name && <p className="text-xs text-gray-600">{a.Name}</p>}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">{a.CreateTime || '-'}</span>
                  <div className="flex gap-2">
                    {a.URL && <a href={a.URL} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs">预览</a>}
                    <button onClick={() => navigator.clipboard.writeText(`asset://${a.Id}`)} className="text-xs text-gray-500">📋</button>
                  </div>
                </div>
                {a.Error && <p className="text-xs text-red-500">❌ {a.Error.Message || a.Error.Code}</p>}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {assetTotal > assetPageSize && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => fetchAssets(assetPage - 1)}
                disabled={assetPage <= 1 || assetsLoading}
                className="px-3 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                ← 上一页
              </button>
              <span className="text-sm text-gray-500">第 {assetPage} 页 / 共 {Math.ceil(assetTotal / assetPageSize)} 页</span>
              <button
                onClick={() => fetchAssets(assetPage + 1)}
                disabled={assetPage >= Math.ceil(assetTotal / assetPageSize) || assetsLoading}
                className="px-3 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                下一页 →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ Tab: Create Asset ═══ */}
      {activeTab === 'create' && (
        <div className="space-y-4 max-w-2xl">
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 space-y-1">
            <p className="font-semibold">📋 素材提交说明</p>
            <p>提交素材后需经过预处理，状态为 Processing → Active 即可使用。</p>
            <p>使用方式：在视频生成请求中通过 <code className="bg-amber-100 px-1 rounded">asset://&lt;ASSET_ID&gt;</code> 引用。</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">素材 URL（必填）</label>
              <input
                type="text"
                value={createUrl}
                onChange={(e) => setCreateUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
                placeholder="https://example.com/asset.jpg"
              />
              <p className="text-xs text-gray-400 mt-1">仅支持公共可访问的 URL，不支持 Base64</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">素材类型（必填）</label>
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                >
                  <option value="Image">🖼️ Image（图像）</option>
                  <option value="Video">🎬 Video（视频）</option>
                  <option value="Audio">🎵 Audio（音频）</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称（可选）</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                  placeholder="素材名称（上限 64 字符）"
                  maxLength={64}
                />
              </div>
            </div>

            <button
              onClick={handleCreate}
              disabled={createLoading || !createUrl.trim()}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium shadow-sm"
            >
              {createLoading ? '提交中...' : '🚀 提交素材'}
            </button>
          </div>

          {/* Requirements */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="font-semibold text-blue-700 mb-1">🖼️ 图像要求</p>
              <ul className="text-blue-600 space-y-0.5 list-disc pl-3">
                <li>格式: jpeg, png, webp, bmp, tiff, gif, heic</li>
                <li>宽高比: 0.4 ~ 2.5</li>
                <li>尺寸: 300 ~ 6000px</li>
                <li>大小: ≤ 30MB</li>
              </ul>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg">
              <p className="font-semibold text-purple-700 mb-1">🎬 视频要求</p>
              <ul className="text-purple-600 space-y-0.5 list-disc pl-3">
                <li>格式: mp4, mov</li>
                <li>分辨率: 480p, 720p</li>
                <li>时长: 2~15s</li>
                <li>大小: ≤ 50MB</li>
                <li>FPS: 24~60</li>
              </ul>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg">
              <p className="font-semibold text-orange-700 mb-1">🎵 音频要求</p>
              <ul className="text-orange-600 space-y-0.5 list-disc pl-3">
                <li>格式: wav, mp3</li>
                <li>时长: 2~15s</li>
                <li>大小: ≤ 15MB</li>
              </ul>
            </div>
          </div>

          {/* Create Result */}
          {createResult && (
            <div className={`p-3 rounded-lg border ${createResult.Id ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
              <p className={`text-sm font-semibold ${createResult.Id ? 'text-green-700' : 'text-red-700'}`}>
                {createResult.Id ? '✅ 提交成功' : '❌ 提交失败'}
              </p>
              {createResult.Id && (
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-xs bg-white px-2 py-1 rounded border font-mono">{createResult.Id}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(createResult.Id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    📋 复制
                  </button>
                  <button
                    onClick={() => { setQueryId(createResult.Id); setActiveTab('my-assets'); }}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    🔍 查看状态
                  </button>
                </div>
              )}
              {!createResult.Id && (
                <pre className="text-xs mt-1 text-red-600">{JSON.stringify(createResult, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ Tab: Public Assets ═══ */}
      {activeTab === 'public' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">平台提供的虚拟人像素材库，可直接用于视频生成。</p>
            <button
              onClick={() => fetchPublicAssets(1)}
              disabled={publicLoading}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {publicLoading ? '加载中...' : '🔄 刷新'}
            </button>
          </div>

          {/* Public Assets Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {publicAssets.length === 0 && !publicLoading && (
              <p className="col-span-full text-center text-gray-400 text-sm py-8">暂无公共素材</p>
            )}
            {publicAssets.map(group => (
              <div key={group.SID} className="border border-gray-100 rounded-lg p-3 hover:shadow-md transition-shadow bg-white">
                <div className="flex justify-between items-start mb-1.5">
                  <h4 className="text-sm font-medium text-gray-800 line-clamp-1" title={group.Title || group.SID}>{group.Title || group.SID}</h4>
                  {group.Score !== undefined && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded whitespace-nowrap ml-2">
                      ⭐ {group.Score.toFixed(1)}
                    </span>
                  )}
                </div>
                {/* Thumbnail Display */}
                {group.Content?.Image?.[0]?.URL && (
                  <div className="mb-2 rounded-md overflow-hidden h-40 bg-gray-100 flex items-center justify-center relative group/img">
                    <img
                      src={group.Content.Image[0].URL}
                      alt={group.Title || 'Asset Thumbnail'}
                      className="w-full h-full object-cover object-center group-hover/img:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </div>
                )}
                {/* Fallback for Video if it exists over image */}
                {!group.Content?.Image?.[0]?.URL && group.Content?.Video?.[0]?.URL && (
                  <div className="mb-2 rounded-md overflow-hidden h-40 bg-gray-100 flex items-center justify-center relative">
                    <video
                      src={group.Content.Video[0].URL}
                      className="w-full h-full object-cover"
                      controls
                      preload="metadata"
                    />
                  </div>
                )}
                {group.Description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mb-2" title={group.Description}>{group.Description}</p>
                )}
                <div className="flex items-center justify-between mt-auto pt-2">
                  <span className="text-xs text-gray-400 font-mono truncate max-w-[140px]" title={group.SID}>{group.SID}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(group.SID)}
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
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => fetchPublicAssets(publicPage - 1)}
                disabled={publicPage <= 1 || publicLoading}
                className="px-3 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                ← 上一页
              </button>
              <span className="text-sm text-gray-500">第 {publicPage} 页 / 共 {Math.ceil(publicTotal / publicPageSize)} 页</span>
              <button
                onClick={() => fetchPublicAssets(publicPage + 1)}
                disabled={publicPage >= Math.ceil(publicTotal / publicPageSize) || publicLoading}
                className="px-3 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                下一页 →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
