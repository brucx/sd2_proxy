import { useState, Fragment } from 'react';
import { api } from '../api';

interface Props {
  users: any[];
}

export default function RequestLogsPanel({ users }: Props) {
  const [requestLogs, setRequestLogs] = useState<any[]>([]);
  const [requestLogsTotal, setRequestLogsTotal] = useState(0);
  const [requestLogsPage, setRequestLogsPage] = useState(1);
  const [requestLogsPageSize] = useState(20);
  const [requestLogsUserFilter, setRequestLogsUserFilter] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const fetchRequestLogs = async (page = requestLogsPage, userId = requestLogsUserFilter) => {
    try {
      const params: any = { page, pageSize: requestLogsPageSize };
      if (userId) params.userId = userId;
      const res = await api.get('/admin/request-logs', { params });
      setRequestLogs(res.data.logs);
      setRequestLogsTotal(res.data.total);
      setRequestLogsPage(res.data.page);
    } catch (err) {
      console.error('Failed to fetch request logs', err);
    }
  };

  // Auto-fetch on mount
  useState(() => { fetchRequestLogs(); });

  return (
    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
      <h2 className="text-xl font-bold mb-4">请求日志 (Request Logs)</h2>
      <div className="flex flex-col sm:flex-row gap-4 mb-4 sm:items-end">
        <div className="w-full sm:w-auto">
          <label className="block text-sm text-gray-600 mb-1">按用户筛选</label>
          <select value={requestLogsUserFilter} onChange={e => { setRequestLogsUserFilter(e.target.value); fetchRequestLogs(1, e.target.value); }} className="border px-3 py-2 rounded-md w-full sm:w-auto">
            <option value="">全部用户</option>
            {users.map(u => (<option key={u.id} value={u.id}>{u.username}</option>))}
          </select>
        </div>
        <button onClick={() => fetchRequestLogs(requestLogsPage, requestLogsUserFilter)} className="bg-gray-600 text-white px-4 py-2 rounded-md h-fit text-sm w-full sm:w-auto">刷新</button>
      </div>
      <div className="text-sm text-gray-500 mb-2">共 {requestLogsTotal} 条记录</div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm hidden md:table">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="p-2"></th><th className="p-2">时间</th><th className="p-2">用户</th><th className="p-2">端点</th><th className="p-2">状态码</th><th className="p-2">耗时</th><th className="p-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {requestLogs.map(log => (
              <Fragment key={log.id}>
                <tr className={`border-b cursor-pointer hover:bg-gray-50 ${expandedLogId === log.id ? 'bg-blue-50' : ''}`} onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}>
                  <td className="p-2 text-gray-400">{expandedLogId === log.id ? '▼' : '▶'}</td>
                  <td className="p-2 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="p-2">{log.username}</td>
                  <td className="p-2 font-mono">{log.endpoint}</td>
                  <td className="p-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${log.responseStatus >= 200 && log.responseStatus < 300 ? 'bg-green-100 text-green-700' : log.responseStatus >= 400 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'}`}>
                      {log.responseStatus}
                    </span>
                  </td>
                  <td className="p-2">{log.durationMs != null ? `${log.durationMs}ms` : '-'}</td>
                  <td className="p-2 text-xs text-gray-500">{log.ipAddress}</td>
                </tr>
                {expandedLogId === log.id && (
                  <tr key={`${log.id}-detail`} className="border-b bg-gray-50">
                    <td colSpan={7} className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-2">Request Body</h4>
                          <pre className="bg-gray-900 text-green-300 p-3 rounded-lg text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                            {log.requestBody ? JSON.stringify(JSON.parse(log.requestBody), null, 2) : '(empty)'}
                          </pre>
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-2">Response Body</h4>
                          <pre className="bg-gray-900 text-blue-300 p-3 rounded-lg text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                            {log.responseBody ? JSON.stringify(JSON.parse(log.responseBody), null, 2) : '(empty)'}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {/* Mobile Cards */}
        <div className="md:hidden grid gap-4">
          {requestLogs.map(log => (
            <div key={log.id} className="border border-gray-100 rounded-lg bg-gray-50 shadow-sm flex flex-col overflow-hidden">
              <div className={`p-4 flex flex-col gap-2 cursor-pointer ${expandedLogId === log.id ? 'bg-blue-50' : ''}`} onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}>
                <div className="flex justify-between items-start mb-1">
                  <span className="font-semibold text-gray-800 break-all">{log.endpoint}</span>
                  <span className={`shrink-0 ml-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${log.responseStatus >= 200 && log.responseStatus < 300 ? 'bg-green-100 text-green-700' : log.responseStatus >= 400 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'}`}>
                    {log.responseStatus}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>User: {log.username}</span>
                  <span>{log.durationMs != null ? `${log.durationMs}ms` : '-'}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{new Date(log.createdAt).toLocaleString()}</span>
                  <span>{log.ipAddress}</span>
                </div>
                <div className="text-center text-gray-400 text-xs mt-1">
                  {expandedLogId === log.id ? 'Tap to hide details ▲' : 'Tap to view details ▼'}
                </div>
              </div>
              {expandedLogId === log.id && (
                <div className="bg-white p-4 border-t border-gray-200">
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <h4 className="font-semibold text-gray-700 mb-2 text-sm">Request Body</h4>
                      <pre className="bg-gray-900 text-green-300 p-3 rounded-lg text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                        {log.requestBody ? JSON.stringify(JSON.parse(log.requestBody), null, 2) : '(empty)'}
                      </pre>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-700 mb-2 text-sm">Response Body</h4>
                      <pre className="bg-gray-900 text-blue-300 p-3 rounded-lg text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                        {log.responseBody ? JSON.stringify(JSON.parse(log.responseBody), null, 2) : '(empty)'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-gray-500">
          第 {requestLogsPage} 页 / 共 {Math.ceil(requestLogsTotal / requestLogsPageSize)} 页
        </div>
        <div className="space-x-2">
          <button disabled={requestLogsPage <= 1} onClick={() => fetchRequestLogs(requestLogsPage - 1, requestLogsUserFilter)} className="px-3 py-1 border rounded-md text-sm disabled:opacity-40">上一页</button>
          <button disabled={requestLogsPage >= Math.ceil(requestLogsTotal / requestLogsPageSize)} onClick={() => fetchRequestLogs(requestLogsPage + 1, requestLogsUserFilter)} className="px-3 py-1 border rounded-md text-sm disabled:opacity-40">下一页</button>
        </div>
      </div>
    </div>
  );
}
