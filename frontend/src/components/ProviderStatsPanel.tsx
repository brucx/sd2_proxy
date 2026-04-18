import { useEffect, useState } from 'react';
import { api } from '../api';

interface ProviderRow {
  provider: string;
  totalTasks: number;
  succeeded: number;
  failed: number;
  pending: number;
  cancelled: number;
  expired: number;
  totalTokens: number;
  totalCost: string;
  avgDurationMs: number | null;
  todayTasks: number;
  todayCost: string;
  rangeTasks: number | null;
  rangeCost: string | null;
}

const providerClass = (p: string) => {
  switch (p) {
    case 'ark': return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'evolink': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'meitu': return 'bg-blue-100 text-blue-700 border-blue-200';
    default: return 'bg-gray-100 text-gray-600 border-gray-200';
  }
};

const formatDuration = (ms: number | null) => {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${rem}s`;
};

export default function ProviderStatsPanel() {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchStats = async (start = startDate, end = endDate) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (start) params.startDate = start;
      if (end) params.endDate = end;
      const res = await api.get('/admin/stats/providers', { params });
      setRows(res.data.providers || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const res = await api.get('/admin/stats/providers/export', { params, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = startDate || endDate ? `_${startDate || ''}_${endDate || ''}` : '';
      a.download = `provider_stats${suffix}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.error || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  const hasRange = !!(startDate || endDate);
  const totalCostAll = rows?.reduce((acc, r) => acc + parseFloat(r.totalCost || '0'), 0) ?? 0;
  const totalTasksAll = rows?.reduce((acc, r) => acc + r.totalTasks, 0) ?? 0;
  const todayCostAll = rows?.reduce((acc, r) => acc + parseFloat(r.todayCost || '0'), 0) ?? 0;
  const rangeCostAll = rows?.reduce((acc, r) => acc + parseFloat(r.rangeCost || '0'), 0) ?? 0;
  const rangeTasksAll = rows?.reduce((acc, r) => acc + (r.rangeTasks || 0), 0) ?? 0;

  return (
    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">分供应商消耗统计</h2>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end mb-4 flex-wrap">
        <div className="w-full sm:w-auto">
          <label className="block text-xs text-gray-500 mb-1">开始日期</label>
          <input
            type="date"
            value={startDate}
            onChange={e => { setStartDate(e.target.value); fetchStats(e.target.value, endDate); }}
            className="border px-3 py-1.5 rounded-md text-sm w-full sm:w-auto"
          />
        </div>
        <div className="w-full sm:w-auto">
          <label className="block text-xs text-gray-500 mb-1">结束日期</label>
          <input
            type="date"
            value={endDate}
            onChange={e => { setEndDate(e.target.value); fetchStats(startDate, e.target.value); }}
            className="border px-3 py-1.5 rounded-md text-sm w-full sm:w-auto"
          />
        </div>
        {hasRange && (
          <button
            onClick={() => { setStartDate(''); setEndDate(''); fetchStats('', ''); }}
            className="text-sm text-gray-500 hover:text-gray-700 hover:underline px-2 py-1.5"
          >
            清除
          </button>
        )}
        <button
          onClick={() => fetchStats()}
          disabled={loading}
          className="bg-gray-600 text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-40 w-full sm:w-auto"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
        <button
          onClick={exportCsv}
          disabled={exporting || !rows || rows.length === 0}
          className="bg-green-600 text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-40 w-full sm:w-auto"
        >
          {exporting ? '导出中...' : '导出 CSV'}
        </button>
      </div>

      {/* Aggregate chips */}
      {rows && (
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm">
            <span className="text-xs text-blue-500">供应商数</span>
            <div className="font-semibold text-base">{rows.length}</div>
          </div>
          <div className="px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            <span className="text-xs text-green-500">累计任务</span>
            <div className="font-semibold text-base">{totalTasksAll}</div>
          </div>
          <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-sm">
            <span className="text-xs text-orange-500">累计消耗</span>
            <div className="font-semibold text-base">¥{totalCostAll.toFixed(4)}</div>
          </div>
          <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
            <span className="text-xs text-amber-500">今日消耗</span>
            <div className="font-semibold text-base">¥{todayCostAll.toFixed(4)}</div>
          </div>
          {hasRange && (
            <div className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm">
              <span className="text-xs text-indigo-500">区间消耗</span>
              <div className="font-semibold text-base">¥{rangeCostAll.toFixed(4)} <span className="text-xs text-indigo-400">({rangeTasksAll} 任务)</span></div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
      {!error && rows && rows.length === 0 && <p className="text-sm text-gray-500">暂无数据</p>}

      {rows && rows.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm hidden md:table">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-2">Provider</th>
                  <th className="p-2">总任务</th>
                  <th className="p-2">成功</th>
                  <th className="p-2">失败</th>
                  <th className="p-2">进行中</th>
                  <th className="p-2">取消/过期</th>
                  <th className="p-2">总 tokens</th>
                  <th className="p-2">平均处理时长</th>
                  <th className="p-2">今日任务</th>
                  <th className="p-2">今日消耗</th>
                  {hasRange && <th className="p-2">区间任务</th>}
                  {hasRange && <th className="p-2">区间消耗</th>}
                  <th className="p-2">累计消耗</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.provider} className="border-b hover:bg-gray-50">
                    <td className="p-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${providerClass(r.provider)}`}>
                        {r.provider || '-'}
                      </span>
                    </td>
                    <td className="p-2 font-semibold">{r.totalTasks}</td>
                    <td className="p-2 text-green-600">{r.succeeded}</td>
                    <td className="p-2 text-red-500">{r.failed}</td>
                    <td className="p-2 text-yellow-600">{r.pending}</td>
                    <td className="p-2 text-gray-500">{r.cancelled + r.expired}</td>
                    <td className="p-2">{r.totalTokens.toLocaleString()}</td>
                    <td className="p-2 whitespace-nowrap">{formatDuration(r.avgDurationMs)}</td>
                    <td className="p-2">{r.todayTasks}</td>
                    <td className="p-2 font-semibold text-amber-600">¥{r.todayCost}</td>
                    {hasRange && <td className="p-2">{r.rangeTasks ?? 0}</td>}
                    {hasRange && <td className="p-2 font-semibold text-indigo-600">¥{r.rangeCost ?? '0.0000'}</td>}
                    <td className="p-2 font-semibold text-orange-600">¥{r.totalCost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden grid gap-3">
            {rows.map(r => (
              <div key={r.provider} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <div className="flex justify-between items-center mb-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${providerClass(r.provider)}`}>
                    {r.provider || '-'}
                  </span>
                  <span className="text-xs text-gray-500">{r.totalTasks} 任务</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <div>成功 <span className="text-green-600 font-semibold">{r.succeeded}</span></div>
                  <div>失败 <span className="text-red-500 font-semibold">{r.failed}</span></div>
                  <div>进行中 <span className="text-yellow-600 font-semibold">{r.pending}</span></div>
                  <div>取消/过期 <span className="text-gray-500 font-semibold">{r.cancelled + r.expired}</span></div>
                  <div>平均处理时长 <span className="font-semibold">{formatDuration(r.avgDurationMs)}</span></div>
                  <div>Tokens <span className="font-semibold">{r.totalTokens.toLocaleString()}</span></div>
                </div>
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200 text-sm">
                  <span className="text-amber-600 font-semibold">今日 ¥{r.todayCost}</span>
                  <span className="text-orange-600 font-semibold">累计 ¥{r.totalCost}</span>
                </div>
                {hasRange && (
                  <div className="text-sm text-indigo-600 font-semibold mt-1">
                    区间 ¥{r.rangeCost ?? '0.0000'} <span className="text-xs text-indigo-400">({r.rangeTasks ?? 0} 任务)</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
