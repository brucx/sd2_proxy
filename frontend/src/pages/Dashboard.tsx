import { useState, useEffect, Fragment, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/panel' });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Mask an API key: show first 8 + '...' + last 4 chars */
const maskKey = (key: string) => {
  if (!key || key.length <= 14) return key;
  return key.slice(0, 8) + '····' + key.slice(-4);
};

function Dashboard() {
  const navigate = useNavigate();
  const role = localStorage.getItem('role');
  const [keys, setKeys] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usagePage, setUsagePage] = useState(1);
  const [usagePageSize] = useState(20);
  const [usageUserFilter, setUsageUserFilter] = useState<string>('');
  const [usageStartDate, setUsageStartDate] = useState('');
  const [usageEndDate, setUsageEndDate] = useState('');
  const [usageTotalTokens, setUsageTotalTokens] = useState(0);
  const [usageTotalCost, setUsageTotalCost] = useState('0');
  const [usageKeySummary, setUsageKeySummary] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [adminKeys, setAdminKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [adminKeyUserId, setAdminKeyUserId] = useState<number | ''>('');
  const [adminKeyName, setAdminKeyName] = useState('');

  // Change own password state
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');

  // Admin reset password state
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  // Admin concurrency limit editing state
  const [editConcurrencyUserId, setEditConcurrencyUserId] = useState<number | null>(null);
  const [editConcurrencyValue, setEditConcurrencyValue] = useState('');

  // Request logs state (admin only)
  const [requestLogs, setRequestLogs] = useState<any[]>([]);
  const [requestLogsTotal, setRequestLogsTotal] = useState(0);
  const [requestLogsPage, setRequestLogsPage] = useState(1);
  const [requestLogsPageSize] = useState(20);
  const [requestLogsUserFilter, setRequestLogsUserFilter] = useState<string>('');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [expandedUsageId, setExpandedUsageId] = useState<number | null>(null);
  const [usageResultCache, setUsageResultCache] = useState<Record<number, string | null>>({});
  const [usageResultLoading, setUsageResultLoading] = useState<number | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);

  // IP Whitelist state (tenant)
  const [whitelist, setWhitelist] = useState<any[]>([]);
  const [newWhitelistIp, setNewWhitelistIp] = useState('');
  const [whitelistMsg, setWhitelistMsg] = useState('');

  const copyKey = useCallback(async (keyId: number, apiKey: string) => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedKeyId(keyId);
      setTimeout(() => setCopiedKeyId(null), 1500);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = apiKey;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedKeyId(keyId);
      setTimeout(() => setCopiedKeyId(null), 1500);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/login');
      return;
    }
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      if (role === 'admin') {
        const [usersRes, keysRes] = await Promise.all([
          api.get('/admin/users'),
          api.get('/admin/keys')
        ]);
        setUsers(usersRes.data);
        setAdminKeys(keysRes.data);
        fetchUsage();
        fetchRequestLogs();
      } else {
        const [keysRes, whitelistRes] = await Promise.all([
          api.get('/keys'),
          api.get('/whitelist')
        ]);
        setKeys(keysRes.data);
        setWhitelist(whitelistRes.data);
        fetchUsage();
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate('/login');
      }
    }
  };

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
    if (expandedUsageId === logId) {
      setExpandedUsageId(null);
      return;
    }
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

  const createKey = async () => {
    if (!newKeyName) return;
    await api.post('/keys', { name: newKeyName });
    setNewKeyName('');
    fetchData();
  };

  const deleteKey = async (keyId: number) => {
    if (!window.confirm('确定要删除该 Key 吗？删除后将无法恢复使用。')) return;
    await api.delete(`/keys/${keyId}`);
    fetchData();
  };

  const createUser = async () => {
    if (!newUserName || !newUserPass) return;
    await api.post('/admin/users', { username: newUserName, password: newUserPass, role: 'tenant' });
    setNewUserName('');
    setNewUserPass('');
    fetchData();
  };

  const createAdminKey = async () => {
    if (!adminKeyUserId || !adminKeyName) return;
    await api.post('/admin/keys', { userId: adminKeyUserId, name: adminKeyName });
    setAdminKeyUserId('');
    setAdminKeyName('');
    fetchData();
  };

  const toggleKey = async (keyId: number) => {
    await api.put(`/admin/keys/${keyId}/toggle`);
    fetchData();
  };

  const changeOwnPassword = async () => {
    setPwdMsg('');
    if (!oldPwd || !newPwd) { setPwdMsg('请填写所有字段'); return; }
    if (newPwd !== confirmPwd) { setPwdMsg('两次输入的新密码不一致'); return; }
    try {
      await api.put('/me/password', { oldPassword: oldPwd, newPassword: newPwd });
      setPwdMsg('密码修改成功！');
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      setTimeout(() => { setShowChangePwd(false); setPwdMsg(''); }, 1500);
    } catch (err: any) {
      setPwdMsg(err.response?.data?.error || '修改失败');
    }
  };

  const adminResetPassword = async (userId: number) => {
    setResetMsg('');
    if (!resetPwd) { setResetMsg('请输入新密码'); return; }
    try {
      await api.put(`/admin/users/${userId}/password`, { newPassword: resetPwd });
      setResetMsg('密码重置成功！');
      setResetPwd('');
      setTimeout(() => { setResetUserId(null); setResetMsg(''); }, 1500);
    } catch (err: any) {
      setResetMsg(err.response?.data?.error || '重置失败');
    }
  };

  const updateConcurrencyLimit = async (userId: number) => {
    const val = parseInt(editConcurrencyValue);
    if (isNaN(val) || val < 1 || val > 100) { alert('并发数必须在 1-100 之间'); return; }
    try {
      await api.put(`/admin/users/${userId}/concurrency`, { concurrencyLimit: val });
      setEditConcurrencyUserId(null);
      setEditConcurrencyValue('');
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || '修改失败');
    }
  };

  const addWhitelistIp = async () => {
    setWhitelistMsg('');
    if (!newWhitelistIp.trim()) { setWhitelistMsg('请输入 IP 地址'); return; }
    try {
      await api.post('/whitelist', { ipAddress: newWhitelistIp.trim() });
      setNewWhitelistIp('');
      setWhitelistMsg('添加成功');
      fetchData();
      setTimeout(() => setWhitelistMsg(''), 1500);
    } catch (err: any) {
      setWhitelistMsg(err.response?.data?.error || '添加失败');
    }
  };

  const deleteWhitelistIp = async (id: number) => {
    try {
      await api.delete(`/whitelist/${id}`);
      fetchData();
    } catch (err: any) {
      setWhitelistMsg(err.response?.data?.error || '删除失败');
    }
  };

  const logout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 bg-white p-4 rounded-xl shadow-sm">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">API Proxy Dashboard</h1>
        <div className="flex flex-wrap gap-4">
          <Link to="/playground" className="text-blue-600 hover:underline font-medium">API Playground</Link>
          <button onClick={() => setShowChangePwd(!showChangePwd)} className="text-indigo-600 hover:underline font-medium">修改密码</button>
          <button onClick={logout} className="text-red-500 hover:underline font-medium">Logout</button>
        </div>
      </div>

      {/* Change Own Password Section */}
      {showChangePwd && (
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm mb-8">
          <h2 className="text-xl font-bold mb-4">修改密码</h2>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end flex-wrap">
            <div className="w-full sm:w-auto">
              <label className="block text-sm text-gray-600 mb-1">旧密码</label>
              <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-sm text-gray-600 mb-1">新密码</label>
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-sm text-gray-600 mb-1">确认新密码</label>
              <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
            </div>
            <button onClick={changeOwnPassword} className="bg-indigo-600 text-white px-4 py-2 rounded-md h-10 w-full sm:w-auto">确认修改</button>
          </div>
          {pwdMsg && <p className={`mt-3 text-sm font-medium ${pwdMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{pwdMsg}</p>}
        </div>
      )}

      {role === 'admin' ? (
        <div className="space-y-8">
          <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">Users Management</h2>
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <input type="text" placeholder="Username" value={newUserName} onChange={e => setNewUserName(e.target.value)} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
              <input type="password" placeholder="Password" value={newUserPass} onChange={e => setNewUserPass(e.target.value)} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
              <button onClick={createUser} className="bg-blue-600 text-white px-4 py-2 rounded-md w-full sm:w-auto whitespace-nowrap">Create Tenant</button>
            </div>
            {/* Desktop Table */}
            <table className="w-full text-left border-collapse hidden md:table">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">ID</th><th className="p-2">Username</th><th className="p-2">Role</th><th className="p-2">并发限制</th><th className="p-2">操作</th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b">
                    <td className="p-2">{u.id}</td>
                    <td className="p-2">{u.username}</td>
                    <td className="p-2">{u.role}</td>
                    <td className="p-2">
                      {editConcurrencyUserId === u.id ? (
                        <div className="flex gap-1 items-center">
                          <input type="number" min="1" max="100" value={editConcurrencyValue} onChange={e => setEditConcurrencyValue(e.target.value)} className="border px-2 py-1 rounded-md text-sm w-16" />
                          <button onClick={() => updateConcurrencyLimit(u.id)} className="bg-blue-500 text-white px-2 py-1 rounded-md text-xs">保存</button>
                          <button onClick={() => setEditConcurrencyUserId(null)} className="text-gray-500 hover:underline text-xs">取消</button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-mono text-sm">
                            <span className={u.activeConcurrency >= u.concurrencyLimit ? 'text-red-600 font-bold' : 'text-green-600'}>{u.activeConcurrency}</span>
                            <span className="text-gray-400"> / </span>
                            <span>{u.concurrencyLimit}</span>
                          </span>
                          <button onClick={() => { setEditConcurrencyUserId(u.id); setEditConcurrencyValue(String(u.concurrencyLimit)); }} className="text-blue-500 hover:underline text-xs">修改</button>
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {resetUserId === u.id ? (
                        <div className="flex gap-2 items-center">
                          <input type="password" placeholder="新密码" value={resetPwd} onChange={e => setResetPwd(e.target.value)} className="border px-2 py-1 rounded-md text-sm w-32" />
                          <button onClick={() => adminResetPassword(u.id)} className="bg-orange-500 text-white px-3 py-1 rounded-md text-sm">确认</button>
                          <button onClick={() => { setResetUserId(null); setResetPwd(''); setResetMsg(''); }} className="text-gray-500 hover:underline text-sm">取消</button>
                          {resetMsg && <span className={`text-xs ${resetMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{resetMsg}</span>}
                        </div>
                      ) : (
                        <button onClick={() => { setResetUserId(u.id); setResetPwd(''); setResetMsg(''); }} className="text-orange-600 hover:underline text-sm">重置密码</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Mobile Cards */}
            <div className="md:hidden grid gap-4">
              {users.map(u => (
                <div key={u.id} className="border border-gray-100 rounded-lg p-4 bg-gray-50 shadow-sm flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-800">{u.username}</span>
                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">ID: {u.id}</span>
                  </div>
                  <div className="text-sm text-gray-600">Created: {new Date(u.createdAt).toLocaleDateString()}</div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-600">并发:</span>
                    {editConcurrencyUserId === u.id ? (
                      <div className="flex gap-1 items-center">
                        <input type="number" min="1" max="100" value={editConcurrencyValue} onChange={e => setEditConcurrencyValue(e.target.value)} className="border px-2 py-1 rounded-md text-sm w-16" />
                        <button onClick={() => updateConcurrencyLimit(u.id)} className="bg-blue-500 text-white px-2 py-1 rounded-md text-xs">保存</button>
                        <button onClick={() => setEditConcurrencyUserId(null)} className="text-gray-500 hover:underline text-xs">取消</button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono">
                          <span className={u.activeConcurrency >= u.concurrencyLimit ? 'text-red-600 font-bold' : 'text-green-600'}>{u.activeConcurrency}</span>
                          <span className="text-gray-400"> / </span>
                          <span>{u.concurrencyLimit}</span>
                        </span>
                        <button onClick={() => { setEditConcurrencyUserId(u.id); setEditConcurrencyValue(String(u.concurrencyLimit)); }} className="text-blue-500 hover:underline text-xs">修改</button>
                      </span>
                    )}
                  </div>
                  <div className="pt-2 border-t border-gray-200 mt-1">
                    {resetUserId === u.id ? (
                      <div className="flex flex-col gap-2 mt-2">
                        <input type="password" placeholder="新密码" value={resetPwd} onChange={e => setResetPwd(e.target.value)} className="border px-2 py-1 rounded-md text-sm" />
                        <div className="flex gap-2">
                          <button onClick={() => adminResetPassword(u.id)} className="bg-orange-500 text-white px-3 py-1 rounded-md text-sm flex-1">确认</button>
                          <button onClick={() => { setResetUserId(null); setResetPwd(''); setResetMsg(''); }} className="bg-gray-200 text-gray-700 px-3 py-1 rounded-md text-sm flex-1">取消</button>
                        </div>
                        {resetMsg && <span className={`text-xs ${resetMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{resetMsg}</span>}
                      </div>
                    ) : (
                      <button onClick={() => { setResetUserId(u.id); setResetPwd(''); setResetMsg(''); }} className="text-orange-600 hover:underline text-sm">重置密码</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">Key 管理</h2>
            <div className="flex flex-col sm:flex-row gap-4 mb-4 sm:items-end">
              <div className="w-full sm:w-auto">
                <label className="block text-sm text-gray-600 mb-1">用户</label>
                <select value={adminKeyUserId} onChange={e => setAdminKeyUserId(e.target.value ? parseInt(e.target.value) : '')} className="border px-3 py-2 rounded-md w-full sm:w-auto">
                  <option value="">选择用户</option>
                  {users.filter(u => u.role === 'tenant').map(u => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
              </div>
              <div className="w-full sm:w-auto">
                <label className="block text-sm text-gray-600 mb-1">Key 名称</label>
                <input type="text" placeholder="Key Name" value={adminKeyName} onChange={e => setAdminKeyName(e.target.value)} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
              </div>
              <button onClick={createAdminKey} className="bg-blue-600 text-white px-4 py-2 rounded-md h-fit w-full sm:w-auto">创建 Key</button>
            </div>
            {/* Desktop Table */}
            <table className="w-full text-left border-collapse text-sm hidden md:table">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">用户</th><th className="p-2">名称</th><th className="p-2">API Key</th><th className="p-2">状态</th><th className="p-2">创建时间</th><th className="p-2">操作</th></tr>
              </thead>
              <tbody>
                {adminKeys.map(k => (
                  <tr key={k.id} className="border-b">
                    <td className="p-2">{k.username}</td>
                    <td className="p-2">{k.name}</td>
                    <td className="p-2 font-mono text-xs text-gray-600">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{maskKey(k.apiKey)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyKey(k.id, k.apiKey); }}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors"
                          title="复制 Key"
                        >
                          {copiedKeyId === k.id ? '✅' : '📋'}
                        </button>
                      </span>
                    </td>
                    <td className="p-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${k.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {k.enabled ? '启用' : '禁用'}
                      </span>
                    </td>
                    <td className="p-2">{new Date(k.createdAt).toLocaleDateString()}</td>
                    <td className="p-2">
                      <button onClick={() => toggleKey(k.id)} className={`text-sm font-medium ${k.enabled ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'}`}>
                        {k.enabled ? '禁用' : '启用'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Mobile Cards */}
            <div className="md:hidden grid gap-4">
              {adminKeys.map(k => (
                <div key={k.id} className="border border-gray-100 rounded-lg p-4 bg-gray-50 shadow-sm flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-800">{k.name}</span>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${k.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {k.enabled ? '启用' : '禁用'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">User: {k.username}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-xs text-gray-600">{maskKey(k.apiKey)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyKey(k.id, k.apiKey); }}
                      className="inline-flex items-center px-2 py-1 rounded text-xs bg-gray-200 hover:bg-blue-100 text-gray-600 hover:text-blue-600 transition-colors"
                      title="复制 Key"
                    >
                      {copiedKeyId === k.id ? '✅ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-1">
                    <span className="text-xs text-gray-500">{new Date(k.createdAt).toLocaleDateString()}</span>
                    <button onClick={() => toggleKey(k.id)} className={`text-sm font-medium ${k.enabled ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'}`}>
                      {k.enabled ? '禁用' : '启用'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">Global Usage Statistics</h2>
            <div className="flex flex-col sm:flex-row gap-4 mb-4 sm:items-end flex-wrap">
              <div className="w-full sm:w-auto">
                <label className="block text-sm text-gray-600 mb-1">按用户筛选</label>
                <select value={usageUserFilter} onChange={e => { setUsageUserFilter(e.target.value); fetchUsage(1, e.target.value, usageStartDate, usageEndDate); }} className="border px-3 py-2 rounded-md w-full sm:w-auto">
                  <option value="">全部用户</option>
                  {users.map(u => (<option key={u.id} value={u.id}>{u.username}</option>))}
                </select>
              </div>
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
            {/* Desktop Table */}
            <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm hidden md:table">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2"></th><th className="p-2">用户</th><th className="p-2">Key ID</th><th className="p-2">Task ID</th><th className="p-2">Tokens</th><th className="p-2">输入类型</th><th className="p-2">单价(元/百万)</th><th className="p-2">费用(元)</th><th className="p-2">Status</th><th className="p-2">时间</th></tr>
              </thead>
              <tbody>
                {usage.map(u => (
                  <Fragment key={u.id}>
                  <tr
                    className={`border-b cursor-pointer hover:bg-gray-50 ${expandedUsageId === u.id ? 'bg-blue-50' : ''}`}
                    onClick={() => fetchUsageResult(u.id)}
                  >
                    <td className="p-2 text-gray-400">{expandedUsageId === u.id ? '▼' : '▶'}</td>
                    <td className="p-2">{u.username}</td>
                    <td className="p-2">{u.keyId}</td>
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
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.status === 'succeeded' ? 'bg-green-100 text-green-700' :
                        u.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'
                      }`}>{u.status}</span>
                    </td>
                    <td className="p-2 whitespace-nowrap">{new Date(u.createdAt).toLocaleString()}</td>
                  </tr>
                  {expandedUsageId === u.id && (
                    <tr key={`${u.id}-detail`} className="border-b bg-gray-50">
                      <td colSpan={10} className="p-4">
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
                  <div
                    className={`p-4 flex flex-col gap-2 cursor-pointer ${expandedUsageId === u.id ? 'bg-blue-50' : ''}`}
                    onClick={() => fetchUsageResult(u.id)}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-800">{u.username}</span>
                      <span className={`text-xs font-semibold px-2 py-1 rounded ${
                        u.status === 'succeeded' ? 'bg-green-100 text-green-700' :
                        u.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'
                      }`}>{u.status}</span>
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

          {/* Request Logs Section */}
          <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">请求日志 (Request Logs)</h2>
            <div className="flex flex-col sm:flex-row gap-4 mb-4 sm:items-end">
              <div className="w-full sm:w-auto">
                <label className="block text-sm text-gray-600 mb-1">按用户筛选</label>
                <select
                  value={requestLogsUserFilter}
                  onChange={e => {
                    setRequestLogsUserFilter(e.target.value);
                    fetchRequestLogs(1, e.target.value);
                  }}
                  className="border px-3 py-2 rounded-md w-full sm:w-auto"
                >
                  <option value="">全部用户</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => fetchRequestLogs(requestLogsPage, requestLogsUserFilter)}
                className="bg-gray-600 text-white px-4 py-2 rounded-md h-fit text-sm w-full sm:w-auto"
              >刷新</button>
            </div>

            <div className="text-sm text-gray-500 mb-2">共 {requestLogsTotal} 条记录</div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm hidden md:table">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="p-2"></th>
                    <th className="p-2">时间</th>
                    <th className="p-2">用户</th>
                    <th className="p-2">端点</th>
                    <th className="p-2">状态码</th>
                    <th className="p-2">耗时</th>
                    <th className="p-2">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {requestLogs.map(log => (
                    <Fragment key={log.id}>
                      <tr
                        key={log.id}
                        className={`border-b cursor-pointer hover:bg-gray-50 ${expandedLogId === log.id ? 'bg-blue-50' : ''}`}
                        onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                      >
                        <td className="p-2 text-gray-400">{expandedLogId === log.id ? '▼' : '▶'}</td>
                        <td className="p-2 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                        <td className="p-2">{log.username}</td>
                        <td className="p-2 font-mono">{log.endpoint}</td>
                        <td className="p-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            log.responseStatus >= 200 && log.responseStatus < 300 ? 'bg-green-100 text-green-700' :
                            log.responseStatus >= 400 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'
                          }`}>
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

              {/* Mobile Cards for Request Logs */}
              <div className="md:hidden grid gap-4">
                {requestLogs.map(log => (
                  <div key={log.id} className="border border-gray-100 rounded-lg bg-gray-50 shadow-sm flex flex-col overflow-hidden">
                    <div
                      className={`p-4 flex flex-col gap-2 cursor-pointer ${expandedLogId === log.id ? 'bg-blue-50' : ''}`}
                      onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-gray-800 break-all">{log.endpoint}</span>
                        <span className={`shrink-0 ml-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          log.responseStatus >= 200 && log.responseStatus < 300 ? 'bg-green-100 text-green-700' :
                          log.responseStatus >= 400 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'
                        }`}>
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
                <button
                  disabled={requestLogsPage <= 1}
                  onClick={() => fetchRequestLogs(requestLogsPage - 1, requestLogsUserFilter)}
                  className="px-3 py-1 border rounded-md text-sm disabled:opacity-40"
                >上一页</button>
                <button
                  disabled={requestLogsPage >= Math.ceil(requestLogsTotal / requestLogsPageSize)}
                  onClick={() => fetchRequestLogs(requestLogsPage + 1, requestLogsUserFilter)}
                  className="px-3 py-1 border rounded-md text-sm disabled:opacity-40"
                >下一页</button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">API Keys</h2>
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <input type="text" placeholder="Key Name" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} className="border px-3 py-2 rounded-md flex-1 w-full" />
              <button onClick={createKey} className="bg-blue-600 text-white px-4 py-2 rounded-md w-full sm:w-auto">Create Key</button>
            </div>
            {/* Desktop Table */}
            <table className="w-full text-left border-collapse hidden md:table">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">Name</th><th className="p-2">API Key</th><th className="p-2">Created</th><th className="p-2">操作</th></tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-b">
                    <td className="p-2">{k.name}</td>
                    <td className="p-2 font-mono text-sm text-gray-600">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{maskKey(k.apiKey)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyKey(k.id, k.apiKey); }}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors"
                          title="复制 Key"
                        >
                          {copiedKeyId === k.id ? '✅' : '📋'}
                        </button>
                      </span>
                    </td>
                    <td className="p-2 text-sm">{new Date(k.createdAt).toLocaleDateString()}</td>
                    <td className="p-2">
                      <button onClick={() => deleteKey(k.id)} className="text-red-500 hover:underline text-sm">删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Mobile Cards */}
            <div className="md:hidden grid gap-4">
              {keys.map(k => (
                <div key={k.id} className="border border-gray-100 rounded-lg p-4 bg-gray-50 shadow-sm flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-800">{k.name}</span>
                    <span className="text-xs text-gray-500">{new Date(k.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-xs text-gray-600">{maskKey(k.apiKey)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyKey(k.id, k.apiKey); }}
                      className="inline-flex items-center px-2 py-1 rounded text-xs bg-gray-200 hover:bg-blue-100 text-gray-600 hover:text-blue-600 transition-colors"
                      title="复制 Key"
                    >
                      {copiedKeyId === k.id ? '✅ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-1">
                    <span className="text-xs text-gray-500">{new Date(k.createdAt).toLocaleDateString()}</span>
                    <button onClick={() => deleteKey(k.id)} className="text-red-500 hover:underline text-sm">删除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* IP Whitelist Management */}
          <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-1">IP 白名单</h2>
            <p className="text-sm text-gray-500 mb-4">设置后仅允许白名单中的 IP 调用 API，最多 2 个。未设置时不限制。</p>
            <div className="flex flex-col sm:flex-row gap-4 mb-4 sm:items-end">
              <div className="w-full">
                <label className="block text-sm text-gray-600 mb-1">IP 地址</label>
                <input
                  type="text"
                  placeholder="例如 1.2.3.4"
                  value={newWhitelistIp}
                  onChange={e => setNewWhitelistIp(e.target.value)}
                  className="border px-3 py-2 rounded-md w-full"
                  disabled={whitelist.length >= 2}
                />
              </div>
              <button
                onClick={addWhitelistIp}
                disabled={whitelist.length >= 2}
                className="bg-blue-600 text-white px-4 py-2 rounded-md disabled:opacity-40 h-10 w-full sm:w-auto shrink-0"
              >{whitelist.length >= 2 ? '已达上限' : '添加'}</button>
            </div>
            {whitelistMsg && <p className={`mb-3 text-sm font-medium ${whitelistMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{whitelistMsg}</p>}
            {whitelist.length === 0 ? (
              <p className="text-gray-400 text-sm">暂无白名单 IP（所有 IP 均可访问）</p>
            ) : (
              <>
                {/* Desktop Table */}
                <table className="w-full text-left border-collapse text-sm hidden md:table">
                  <thead>
                    <tr className="border-b bg-gray-50"><th className="p-2">IP 地址</th><th className="p-2">添加时间</th><th className="p-2">操作</th></tr>
                  </thead>
                  <tbody>
                    {whitelist.map(w => (
                      <tr key={w.id} className="border-b">
                        <td className="p-2 font-mono">{w.ipAddress}</td>
                        <td className="p-2">{new Date(w.createdAt).toLocaleString()}</td>
                        <td className="p-2">
                          <button onClick={() => deleteWhitelistIp(w.id)} className="text-red-500 hover:underline text-sm">删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Mobile Cards */}
                <div className="md:hidden grid gap-4">
                  {whitelist.map(w => (
                    <div key={w.id} className="border border-gray-100 rounded-lg p-4 bg-gray-50 shadow-sm flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-gray-800 break-all">{w.ipAddress}</span>
                        <button onClick={() => deleteWhitelistIp(w.id)} className="text-red-500 hover:underline text-sm shrink-0 ml-2">删除</button>
                      </div>
                      <div className="text-xs text-gray-500">{new Date(w.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">Usage Statistics</h2>
            <div className="flex flex-col sm:flex-row gap-4 mb-4 sm:items-end flex-wrap">
              <div className="w-full sm:w-auto">
                <label className="block text-sm text-gray-600 mb-1">开始日期</label>
                <input type="date" value={usageStartDate} onChange={e => { setUsageStartDate(e.target.value); fetchUsage(1, '', e.target.value, usageEndDate); }} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
              </div>
              <div className="w-full sm:w-auto">
                <label className="block text-sm text-gray-600 mb-1">结束日期</label>
                <input type="date" value={usageEndDate} onChange={e => { setUsageEndDate(e.target.value); fetchUsage(1, '', usageStartDate, e.target.value); }} className="border px-3 py-2 rounded-md w-full sm:w-auto" />
              </div>
              <button onClick={() => fetchUsage(usagePage, '', usageStartDate, usageEndDate)} className="bg-gray-600 text-white px-4 py-2 rounded-md h-fit text-sm w-full sm:w-auto">刷新</button>
              <button onClick={exportUsageCsv} className="bg-green-600 text-white px-4 py-2 rounded-md h-fit text-sm w-full sm:w-auto">导出 CSV</button>
            </div>
            <div className="flex flex-wrap gap-4 mb-4">
              <p className="font-medium text-lg text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
                Total Tokens: {usageTotalTokens}
              </p>
              <p className="font-medium text-lg text-blue-700 bg-blue-50 p-3 rounded-lg border border-blue-200">
                Total Cost: ¥{usageTotalCost}
              </p>
            </div>
            <div className="text-sm text-gray-500 mb-2">共 {usageTotal} 条记录</div>
            {/* Per-Key Summary */}
            {usageKeySummary.length > 0 && (
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
                <tr className="border-b bg-gray-50"><th className="p-2"></th><th className="p-2">Endpoint</th><th className="p-2">Task ID</th><th className="p-2">Tokens</th><th className="p-2">输入类型</th><th className="p-2">单价(元/百万)</th><th className="p-2">费用(元)</th><th className="p-2">Status</th><th className="p-2">时间</th></tr>
              </thead>
              <tbody>
                {usage.map(u => (
                  <Fragment key={u.id}>
                  <tr
                    className={`border-b cursor-pointer hover:bg-gray-50 ${expandedUsageId === u.id ? 'bg-blue-50' : ''}`}
                    onClick={() => fetchUsageResult(u.id)}
                  >
                    <td className="p-2 text-gray-400">{expandedUsageId === u.id ? '▼' : '▶'}</td>
                    <td className="p-2">{u.endpoint}</td>
                    <td className="p-2 font-mono text-xs">{u.taskId}</td>
                    <td className="p-2 font-semibold">{u.completionTokens}</td>
                    <td className="p-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${u.hasVideoInput ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                        {u.hasVideoInput ? '含视频' : '纯文本'}
                      </span>
                    </td>
                    <td className="p-2">{u.hasVideoInput ? '28' : '46'}</td>
                    <td className="p-2 font-semibold text-orange-600">¥{parseFloat(u.costYuan || '0').toFixed(4)}</td>
                    <td className="p-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.status === 'succeeded' ? 'bg-green-100 text-green-700' :
                        u.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'
                      }`}>{u.status}</span>
                    </td>
                    <td className="p-2 whitespace-nowrap">{new Date(u.createdAt).toLocaleString()}</td>
                  </tr>
                  {expandedUsageId === u.id && (
                    <tr key={`${u.id}-detail`} className="border-b bg-gray-50">
                      <td colSpan={9} className="p-4">
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
                  <div
                    className={`p-4 flex flex-col gap-2 cursor-pointer ${expandedUsageId === u.id ? 'bg-blue-50' : ''}`}
                    onClick={() => fetchUsageResult(u.id)}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-800 break-all">{u.endpoint}</span>
                      <span className={`shrink-0 ml-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.status === 'succeeded' ? 'bg-green-100 text-green-700' :
                        u.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {u.status}
                      </span>
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
                <button disabled={usagePage <= 1} onClick={() => fetchUsage(usagePage - 1, '', usageStartDate, usageEndDate)} className="px-3 py-1 border rounded-md text-sm disabled:opacity-40">上一页</button>
                <button disabled={usagePage >= Math.ceil(usageTotal / usagePageSize)} onClick={() => fetchUsage(usagePage + 1, '', usageStartDate, usageEndDate)} className="px-3 py-1 border rounded-md text-sm disabled:opacity-40">下一页</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;

