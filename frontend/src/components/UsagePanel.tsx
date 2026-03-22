import { useState, Fragment } from 'react';
import { api } from '../api';

interface Props {
  role: string;
  users?: any[];
}

export default function UsagePanel({ role, users }: Props) {
  const [usage, setUsage] = useState<any[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usagePage, setUsagePage] = useState(1);
  const [usagePageSize] = useState(20);
  const [usageUserFilter, setUsageUserFilter] = useState('');
  const [usageStartDate, setUsageStartDate] = useState('');
  const [usageEndDate, setUsageEndDate] = useState('');
  const [usageTotalTokens, setUsageTotalTokens] = useState(0);
  const [usageTotalCost, setUsageTotalCost] = useState('0');
  const [usageKeySummary, setUsageKeySummary] = useState<any[]>([]);
  const [expandedUsageId, setExpandedUsageId] = useState<number | null>(null);
  const [usageResultCache, setUsageResultCache] = useState<Record<number, string | null>>({});
  const [usageResultLoading, setUsageResultLoading] = useState<number | null>(null);

  const fetchUsage = async (page = usagePage, userId = usageUserFilter, start = usageStartDate, end = usageEndDate) => {
    try {
      const params: any = { page, pageSize: usagePageSize };
      if (userId) params.userId = userId;
      if (start) params.startDate = start;
      if (end) params.endDate = end;
      const endpoint = role === 'admin' ? '/admin/usage' : '/usage';
      const res = await api.get(endpoint, { params });
      setUsage(res.data.logs);
      setUsageTotal(res.data.total);
      setUsagePage(res.data.page);
      setUsageTotalTokens(res.data.totalTokens);
      setUsageTotalCost(res.data.totalCost);
      setUsageKeySummary(res.data.keySummary || []);
    } catch (err) {
      console.error('Failed to fetch usage', err);
    }
  };

  const exportUsageCsv = async () => {
    try {
      const params: any = {};
      if (usageUserFilter) params.userId = usageUserFilter;
      if (usageStartDate) params.startDate = usageStartDate;
      if (usageEndDate) params.endDate = usageEndDate;
      const endpoint = role === 'admin' ? '/admin/usage/export' : '/usage/export';
      const res = await api.get(endpoint, { params, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usage_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export usage CSV', err);
    }
  };

  const fetchUsageResult = async (logId: number) => {
    if (expandedUsageId === logId) { setExpandedUsageId(null); return; }
    setExpandedUsageId(logId);
    if (usageResultCache[logId] !== undefined) return;
    setUsageResultLoading(logId);
    try {
      const res = await api.get(`/usage/${logId}/result`);
      setUsageResultCache(prev => ({ ...prev, [logId]: res.data.resultData }));
    } catch {
      setUsageResultCache(prev => ({ ...prev, [logId]: null }));
    } finally {
      setUsageResultLoading(null);
    }
  };

  // Auto-fetch on mount
  useState(() => { fetchUsage(); });

  const isAdmin = role === 'admin';

  return (
    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
      <h2 className="text-xl font-bold mb-4">{isAdmin ? 'Global Usage Statistics' : 'Usage Statistics'}</h2>
      <div className="flex flex-col sm:flex-row gap-4 mb-4 sm:items-end flex-wrap">
        {isAdmin && users && (
          <div className="w-full sm:w-auto">
            <label className="block text-sm text-gray-600 mb-1">按用户筛选</label>
            <select value={usageUserFilter} onChange={e => { setUsageUserFilter(e.target.value); fetchUsage(1, e.target.value, usageStartDate, usageEndDate); }} className="border px-3 py-2 rounded-md w-full sm:w-auto">
              <option value="">全部用户</option>
              {users.map(u => (<option key={u.id} value={u.id}>{u.username}</option>))}
            </select>
          </div>
        )}
        <div className="w-full sm:w-auto">
          <label className="block text-sm text-gray-600 mb-1">开始日期</label>
          <input type="date" value={usageStartDate} onChange={e => { setUsageStartDate(e.target.value); fetchUsage(1, usageUserFilter, e.target.value, usageEndDate); }} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
        </div>
        <div className="w-full sm:w-auto">
          <label className="block text-sm text-gray-600 mb-1">结束日期</label>
          <input type="date" value={usageEndDate} onChange={e => { setUsageEndDate(e.target.value); fetchUsage(1, usageUserFilter, usageStartDate, e.target.value); }} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
        </div>
        <button onClick={() => fetchUsage(usagePage, usageUserFilter, usageStartDate, usageEndDate)} className="bg-gray-600 text-white px-4 py-2 rounded-md h-fit text-sm w-full sm:w-auto">刷新</button>
        <button onClick={exportUsageCsv} className="bg-green-600 text-white px-4 py-2 rounded-md h-fit text-sm w-full sm:w-auto">导出 CSV</button>
      </div>
      <div className="flex flex-wrap gap-4 mb-4">
        <p className="font-medium text-lg text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">Total Tokens: {usageTotalTokens}</p>
        <p className="font-medium text-lg text-blue-700 bg-blue-50 p-3 rounded-lg border border-blue-200">Total Cost: ¥{usageTotalCost}</p>
      </div>
      <div className="text-sm text-gray-500 mb-2">共 {usageTotal} 条记录</div>

      {/* Per-Key Summary (tenant only) */}
      {!isAdmin && usageKeySummary.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">按 API Key 汇总</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {usageKeySummary.map(k => (
              <div key={k.keyId} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <div className="font-medium text-gray-800 text-sm truncate" title={k.keyName}>{k.keyName}</div>
                <div className="flex justify-between items-center mt-2 text-sm">
                  <span className="text-gray-500">{k.requestCount} 次请求</span>
                  <span className="font-semibold text-green-600">{k.totalTokens} tokens</span>
                </div>
                <div className="text-right text-sm font-semibold text-orange-600 mt-1">¥{k.totalCost}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Desktop Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm hidden md:table">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="p-2"></th>
              {isAdmin && <th className="p-2">用户</th>}
              <th className="p-2">API Key</th>
              <th className="p-2">Task ID</th>
              <th className="p-2">Tokens</th>
              <th className="p-2">输入类型</th>
              <th className="p-2">单价(元/百万)</th>
              <th className="p-2">费用(元)</th>
              <th className="p-2">Status</th>
              <th className="p-2">时间</th>
            </tr>
          </thead>
          <tbody>
            {usage.map(u => (
              <Fragment key={u.id}>
                <tr className={`border-b cursor-pointer hover:bg-gray-50 ${expandedUsageId === u.id ? 'bg-blue-50' : ''}`} onClick={() => fetchUsageResult(u.id)}>
                  <td className="p-2 text-gray-400">{expandedUsageId === u.id ? '▼' : '▶'}</td>
                  {isAdmin && <td className="p-2">{u.username}</td>}
                  <td className="p-2">{u.keyName || '-'}</td>
                  <td className="p-2 font-mono text-xs">{u.taskId}</td>
                  <td className="p-2">{u.completionTokens}</td>
                  <td className="p-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${u.hasVideoInput ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                      {u.hasVideoInput ? '含视频' : '纯文本'}
                    </span>
                  </td>
                  <td className="p-2">{u.hasVideoInput ? '28' : '46'}</td>
                  <td className="p-2 font-semibold text-orange-600">¥{parseFloat(u.costYuan || '0').toFixed(4)}</td>
                  <td className="p-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${u.status === 'succeeded' ? 'bg-green-100 text-green-700' : u.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'}`}>{u.status}</span>
                  </td>
                  <td className="p-2 whitespace-nowrap">{new Date(u.createdAt).toLocaleString()}</td>
                </tr>
                {expandedUsageId === u.id && (
                  <tr key={`${u.id}-detail`} className="border-b bg-gray-50">
                    <td colSpan={isAdmin ? 10 : 9} className="p-4">
                      <h4 className="font-semibold text-gray-700 mb-2">任务返回详情</h4>
                      {usageResultLoading === u.id ? (
                        <p className="text-sm text-gray-500">加载中...</p>
                      ) : usageResultCache[u.id] ? (
                        <pre className="bg-gray-900 text-green-300 p-3 rounded-lg text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                          {JSON.stringify(JSON.parse(usageResultCache[u.id]!), null, 2)}
                        </pre>
                      ) : (
                        <p className="text-sm text-gray-400">暂无返回数据</p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden grid gap-4">
        {usage.map(u => (
          <div key={u.id} className="border border-gray-100 rounded-lg bg-gray-50 shadow-sm flex flex-col overflow-hidden">
            <div className={`p-4 flex flex-col gap-2 cursor-pointer ${expandedUsageId === u.id ? 'bg-blue-50' : ''}`} onClick={() => fetchUsageResult(u.id)}>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-800">{isAdmin ? u.username : (u.keyName || '-')}</span>
                <span className={`text-xs font-semibold px-2 py-1 rounded ${u.status === 'succeeded' ? 'bg-green-100 text-green-700' : u.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'}`}>{u.status}</span>
              </div>
              <div className="text-sm text-gray-600 break-all">Task ID: <span className="font-mono text-xs">{u.taskId}</span></div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500 text-xs">{new Date(u.createdAt).toLocaleString()}</span>
                <span className="font-semibold text-green-600">Tokens: {u.completionTokens}</span>
              </div>
              <div className="flex justify-between items-center text-sm pt-1 border-t border-gray-200">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${u.hasVideoInput ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                  {u.hasVideoInput ? '含视频' : '纯文本'} · 单价 {u.hasVideoInput ? '28' : '46'}
                </span>
                <span className="font-semibold text-orange-600">¥{parseFloat(u.costYuan || '0').toFixed(4)}</span>
              </div>
              <div className="text-center text-gray-400 text-xs mt-1">
                {expandedUsageId === u.id ? '收起详情 ▲' : '查看详情 ▼'}
              </div>
            </div>
            {expandedUsageId === u.id && (
              <div className="bg-white p-4 border-t border-gray-200">
                <h4 className="font-semibold text-gray-700 mb-2 text-sm">任务返回详情</h4>
                {usageResultLoading === u.id ? (
                  <p className="text-sm text-gray-500">加载中...</p>
                ) : usageResultCache[u.id] ? (
                  <pre className="bg-gray-900 text-green-300 p-3 rounded-lg text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                    {JSON.stringify(JSON.parse(usageResultCache[u.id]!), null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-gray-400">暂无返回数据</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-gray-500">
          第 {usagePage} 页 / 共 {Math.ceil(usageTotal / usagePageSize)} 页
        </div>
        <div className="space-x-2">
          <button disabled={usagePage <= 1} onClick={() => fetchUsage(usagePage - 1, usageUserFilter, usageStartDate, usageEndDate)} className="px-3 py-1 border rounded-md text-sm disabled:opacity-40">上一页</button>
          <button disabled={usagePage >= Math.ceil(usageTotal / usagePageSize)} onClick={() => fetchUsage(usagePage + 1, usageUserFilter, usageStartDate, usageEndDate)} className="px-3 py-1 border rounded-md text-sm disabled:opacity-40">下一页</button>
        </div>
      </div>
    </div>
  );
}
