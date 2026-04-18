import { useState, useCallback, useEffect } from 'react';
import { api, maskKey } from '../api';

interface Props {
  users: any[];
}

export default function AdminKeysPanel({ users }: Props) {
  const [adminKeys, setAdminKeys] = useState<any[]>([]);
  const [showDisabled, setShowDisabled] = useState(false);
  const [adminKeyUserId, setAdminKeyUserId] = useState<number | ''>('');
  const [adminKeyName, setAdminKeyName] = useState('');
  const [adminKeyProvider, setAdminKeyProvider] = useState('');
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);

  const fetchKeys = useCallback(async (includeDisabled: boolean) => {
    const res = await api.get('/admin/keys', { params: includeDisabled ? { includeDisabled: 'true' } : {} });
    setAdminKeys(res.data);
  }, []);

  useEffect(() => { fetchKeys(showDisabled); }, [fetchKeys, showDisabled]);

  const copyKey = useCallback(async (keyId: number, apiKey: string) => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedKeyId(keyId);
      setTimeout(() => setCopiedKeyId(null), 1500);
    } catch {
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

  const createAdminKey = async () => {
    if (!adminKeyUserId || !adminKeyName) return;
    await api.post('/admin/keys', {
      userId: adminKeyUserId,
      name: adminKeyName,
      ...(adminKeyProvider ? { provider: adminKeyProvider } : {}),
    });
    setAdminKeyUserId(''); setAdminKeyName(''); setAdminKeyProvider('');
    fetchKeys(showDisabled);
  };

  const toggleKey = async (keyId: number) => {
    await api.put(`/admin/keys/${keyId}/toggle`);
    fetchKeys(showDisabled);
  };

  const updateKeyProvider = async (keyId: number, current: string | null) => {
    const input = window.prompt('设置该 Key 的 Provider（meitu / evolink / ark / auto，留空表示跟随用户默认）：', current || '');
    if (input === null) return;
    const value = input.trim().toLowerCase();
    if (value !== '' && !['meitu', 'evolink', 'ark', 'auto'].includes(value)) {
      alert('Provider 必须为 meitu / evolink / ark / auto');
      return;
    }
    try {
      await api.put(`/admin/keys/${keyId}/provider`, { provider: value === '' ? null : value });
      fetchKeys(showDisabled);
    } catch (err: any) {
      alert(err.response?.data?.error || '修改失败');
    }
  };

  const enabledCount = adminKeys.filter(k => k.enabled).length;
  const disabledCount = adminKeys.length - enabledCount;

  return (
    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h2 className="text-xl font-bold">Key 管理</h2>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={e => setShowDisabled(e.target.checked)}
            className="rounded border-gray-300"
          />
          显示已禁用
          <span className="text-xs text-gray-400">（{enabledCount} 启用{showDisabled ? ` / ${disabledCount} 禁用` : ''}）</span>
        </label>
      </div>
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
        <div className="w-full sm:w-auto">
          <label className="block text-sm text-gray-600 mb-1">Provider</label>
          <select value={adminKeyProvider} onChange={e => setAdminKeyProvider(e.target.value)} className="border px-3 py-2 rounded-md w-full sm:w-auto">
            <option value="">跟随用户默认</option>
            <option value="meitu">Meitu</option>
            <option value="evolink">Evolink</option>
            <option value="ark">Ark</option>
            <option value="auto">Auto (Meitu→Evolink)</option>
          </select>
        </div>
        <button onClick={createAdminKey} className="bg-blue-600 text-white px-4 py-2 rounded-md h-fit w-full sm:w-auto">创建 Key</button>
      </div>
      {/* Desktop Table */}
      <table className="w-full text-left border-collapse text-sm hidden md:table">
        <thead>
          <tr className="border-b bg-gray-50"><th className="p-2">用户</th><th className="p-2">名称</th><th className="p-2">API Key</th><th className="p-2">Provider</th><th className="p-2">状态</th><th className="p-2">创建时间</th><th className="p-2">操作</th></tr>
        </thead>
        <tbody>
          {adminKeys.map(k => (
            <tr key={k.id} className="border-b">
              <td className="p-2">{k.username}</td>
              <td className="p-2">{k.name}</td>
              <td className="p-2 font-mono text-xs text-gray-600">
                <span className="inline-flex items-center gap-1.5">
                  <span>{maskKey(k.apiKey)}</span>
                  <button onClick={(e) => { e.stopPropagation(); copyKey(k.id, k.apiKey); }} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors" title="复制 Key">
                    {copiedKeyId === k.id ? '✅' : '📋'}
                  </button>
                </span>
              </td>
              <td className="p-2 text-xs">
                {k.provider
                  ? <span className={`inline-block px-2 py-0.5 rounded font-medium ${k.provider === 'evolink' ? 'bg-purple-100 text-purple-700' : k.provider === 'auto' ? 'bg-amber-100 text-amber-700' : k.provider === 'ark' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{k.provider}</span>
                  : <span className="text-gray-400">跟随用户 ({k.userProvider})</span>}
              </td>
              <td className="p-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${k.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {k.enabled ? '启用' : '禁用'}
                </span>
              </td>
              <td className="p-2">{new Date(k.createdAt).toLocaleDateString()}</td>
              <td className="p-2">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => updateKeyProvider(k.id, k.provider)} className="text-purple-500 hover:underline text-xs">Provider</button>
                  <button onClick={() => toggleKey(k.id)} className={`text-sm font-medium ${k.enabled ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'}`}>
                    {k.enabled ? '禁用' : '启用'}
                  </button>
                </div>
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
            <div className="text-xs text-gray-600">
              Provider: {k.provider
                ? <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${k.provider === 'evolink' ? 'bg-purple-100 text-purple-700' : k.provider === 'auto' ? 'bg-amber-100 text-amber-700' : k.provider === 'ark' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{k.provider}</span>
                : <span className="text-gray-400">跟随用户 ({k.userProvider})</span>}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="font-mono text-xs text-gray-600">{maskKey(k.apiKey)}</span>
              <button onClick={(e) => { e.stopPropagation(); copyKey(k.id, k.apiKey); }} className="inline-flex items-center px-2 py-1 rounded text-xs bg-gray-200 hover:bg-blue-100 text-gray-600 hover:text-blue-600 transition-colors" title="复制 Key">
                {copiedKeyId === k.id ? '✅ Copied' : '📋 Copy'}
              </button>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-1">
              <span className="text-xs text-gray-500">{new Date(k.createdAt).toLocaleDateString()}</span>
              <div className="flex gap-3">
                <button onClick={() => updateKeyProvider(k.id, k.provider)} className="text-purple-500 hover:underline text-sm">Provider</button>
                <button onClick={() => toggleKey(k.id)} className={`text-sm font-medium ${k.enabled ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'}`}>
                  {k.enabled ? '禁用' : '启用'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
