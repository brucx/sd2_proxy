import { useState, useCallback } from 'react';
import { api, maskKey } from '../api';

interface Props {
  keys: any[];
  whitelist: any[];
  tenantBalance: { balance: string; totalTopUp: string; totalConsumed: string; concurrencyLimit: number; activeConcurrency: number } | null;
  rechargeRecords: any[];
  rechargeTotal: number;
  rechargePage: number;
  rechargePageSize: number;
  onRefresh: () => void;
  onFetchRechargeRecords: (page: number) => void;
}

export default function TenantDashboard({
  keys, whitelist, tenantBalance, rechargeRecords, rechargeTotal, rechargePage, rechargePageSize,
  onRefresh, onFetchRechargeRecords
}: Props) {
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [newWhitelistIp, setNewWhitelistIp] = useState('');
  const [whitelistMsg, setWhitelistMsg] = useState('');

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

  const createKey = async () => {
    if (!newKeyName) return;
    await api.post('/keys', { name: newKeyName });
    setNewKeyName('');
    onRefresh();
  };

  const deleteKey = async (keyId: number) => {
    if (!window.confirm('确定要删除该 Key 吗？删除后将无法恢复使用。')) return;
    await api.delete(`/keys/${keyId}`);
    onRefresh();
  };

  const addWhitelistIp = async () => {
    setWhitelistMsg('');
    if (!newWhitelistIp.trim()) { setWhitelistMsg('请输入 IP 地址'); return; }
    try {
      await api.post('/whitelist', { ipAddress: newWhitelistIp.trim() });
      setNewWhitelistIp('');
      setWhitelistMsg('添加成功');
      onRefresh();
      setTimeout(() => setWhitelistMsg(''), 1500);
    } catch (err: any) {
      setWhitelistMsg(err.response?.data?.error || '添加失败');
    }
  };

  const deleteWhitelistIp = async (id: number) => {
    try {
      await api.delete(`/whitelist/${id}`);
      onRefresh();
    } catch (err: any) {
      setWhitelistMsg(err.response?.data?.error || '删除失败');
    }
  };

  return (
    <>
      {/* Balance Card */}
      {tenantBalance && (
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-bold mb-4">账户概览</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`p-4 rounded-lg border-2 ${parseFloat(tenantBalance.balance) <= 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <div className="text-sm text-gray-600">可用余额</div>
              <div className={`text-2xl font-bold ${parseFloat(tenantBalance.balance) <= 0 ? 'text-red-600' : 'text-green-700'}`}>¥{parseFloat(tenantBalance.balance).toFixed(4)}</div>
            </div>
            <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
              <div className="text-sm text-gray-600">总充值</div>
              <div className="text-2xl font-bold text-blue-700">¥{tenantBalance.totalTopUp}</div>
            </div>
            <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
              <div className="text-sm text-gray-600">总消耗</div>
              <div className="text-2xl font-bold text-orange-600">¥{tenantBalance.totalConsumed}</div>
            </div>
            <div className={`p-4 rounded-lg border-2 ${tenantBalance.activeConcurrency >= tenantBalance.concurrencyLimit ? 'bg-red-50 border-red-200' : 'bg-indigo-50 border-indigo-200'}`}>
              <div className="text-sm text-gray-600">并发限制</div>
              <div className="text-2xl font-bold">
                <span className={tenantBalance.activeConcurrency >= tenantBalance.concurrencyLimit ? 'text-red-600' : 'text-green-600'}>{tenantBalance.activeConcurrency}</span>
                <span className="text-gray-400 mx-1">/</span>
                <span className="text-indigo-700">{tenantBalance.concurrencyLimit}</span>
              </div>
            </div>
          </div>
          {parseFloat(tenantBalance.balance) <= 0 && (
            <p className="mt-3 text-sm text-red-600 font-medium">⚠️ 余额不足，将无法创建新任务，请联系管理员充值。</p>
          )}
        </div>
      )}

      {/* Recharge Records */}
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
        <h2 className="text-xl font-bold mb-4">充值记录</h2>
        {rechargeRecords.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无充值记录</p>
        ) : (
          <>
            <div className="text-sm text-gray-500 mb-2">共 {rechargeTotal} 条记录</div>
            <table className="w-full text-left border-collapse text-sm hidden md:table">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">金额(元)</th><th className="p-2">备注</th><th className="p-2">操作人</th><th className="p-2">时间</th></tr>
              </thead>
              <tbody>
                {rechargeRecords.map(r => (
                  <tr key={r.id} className="border-b">
                    <td className={`p-2 font-semibold ${parseFloat(r.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{parseFloat(r.amount) >= 0 ? '+' : '-'}¥{Math.abs(parseFloat(r.amount)).toFixed(2)}</td>
                    <td className="p-2 text-gray-600">{r.description || '-'}</td>
                    <td className="p-2">{r.operatorName}</td>
                    <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="md:hidden grid gap-3">
              {rechargeRecords.map(r => (
                <div key={r.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50 shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className={`font-semibold text-lg ${parseFloat(r.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{parseFloat(r.amount) >= 0 ? '+' : '-'}¥{Math.abs(parseFloat(r.amount)).toFixed(2)}</span>
                    <span className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-1">{r.description || '-'}</div>
                  <div className="text-xs text-gray-400 mt-1">操作人: {r.operatorName}</div>
                </div>
              ))}
            </div>
            {rechargeTotal > rechargePageSize && (
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-gray-500">
                  第 {rechargePage} 页 / 共 {Math.ceil(rechargeTotal / rechargePageSize)} 页
                </div>
                <div className="space-x-2">
                  <button disabled={rechargePage <= 1} onClick={() => onFetchRechargeRecords(rechargePage - 1)} className="px-3 py-1 border rounded-md text-sm disabled:opacity-40">上一页</button>
                  <button disabled={rechargePage >= Math.ceil(rechargeTotal / rechargePageSize)} onClick={() => onFetchRechargeRecords(rechargePage + 1)} className="px-3 py-1 border rounded-md text-sm disabled:opacity-40">下一页</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* API Keys */}
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
        <h2 className="text-xl font-bold mb-4">API Keys</h2>
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <input type="text" placeholder="Key Name" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} className="border px-3 py-2 rounded-md flex-1 w-full" />
          <button onClick={createKey} className="bg-blue-600 text-white px-4 py-2 rounded-md w-full sm:w-auto">Create Key</button>
        </div>
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
                    <button onClick={(e) => { e.stopPropagation(); copyKey(k.id, k.apiKey); }} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors" title="复制 Key">
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
        <div className="md:hidden grid gap-4">
          {keys.map(k => (
            <div key={k.id} className="border border-gray-100 rounded-lg p-4 bg-gray-50 shadow-sm flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-800">{k.name}</span>
                <span className="text-xs text-gray-500">{new Date(k.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-mono text-xs text-gray-600">{maskKey(k.apiKey)}</span>
                <button onClick={(e) => { e.stopPropagation(); copyKey(k.id, k.apiKey); }} className="inline-flex items-center px-2 py-1 rounded text-xs bg-gray-200 hover:bg-blue-100 text-gray-600 hover:text-blue-600 transition-colors" title="复制 Key">
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

      {/* IP Whitelist */}
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm">
        <h2 className="text-xl font-bold mb-1">IP 白名单</h2>
        <p className="text-sm text-gray-500 mb-4">设置后仅允许白名单中的 IP 调用 API，最多 2 个。未设置时不限制。</p>
        <div className="flex flex-col sm:flex-row gap-4 mb-4 sm:items-end">
          <div className="w-full">
            <label className="block text-sm text-gray-600 mb-1">IP 地址</label>
            <input type="text" placeholder="例如 1.2.3.4" value={newWhitelistIp} onChange={e => setNewWhitelistIp(e.target.value)} className="border px-3 py-2 rounded-md w-full" disabled={whitelist.length >= 2} />
          </div>
          <button onClick={addWhitelistIp} disabled={whitelist.length >= 2} className="bg-blue-600 text-white px-4 py-2 rounded-md disabled:opacity-40 h-10 w-full sm:w-auto shrink-0">
            {whitelist.length >= 2 ? '已达上限' : '添加'}
          </button>
        </div>
        {whitelistMsg && <p className={`mb-3 text-sm font-medium ${whitelistMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{whitelistMsg}</p>}
        {whitelist.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无白名单 IP（所有 IP 均可访问）</p>
        ) : (
          <>
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
    </>
  );
}
