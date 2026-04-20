import React, { useState } from 'react';
import { api } from '../api';

interface Props {
  users: any[];
  onRefresh: () => void;
}

export default function AdminUsersPanel({ users, onRefresh }: Props) {
  const [newUserName, setNewUserName] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetMsg, setResetMsg] = useState('');
  const [editConcurrencyUserId, setEditConcurrencyUserId] = useState<number | null>(null);
  const [editConcurrencyValue, setEditConcurrencyValue] = useState('');
  const [topUpUserId, setTopUpUserId] = useState<number | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpDesc, setTopUpDesc] = useState('');
  const [topUpMsg, setTopUpMsg] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [userRecords, setUserRecords] = useState<any[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);

  const createUser = async () => {
    if (!newUserName || !newUserPass) return;
    await api.post('/admin/users', { username: newUserName, password: newUserPass, role: 'tenant' });
    setNewUserName(''); setNewUserPass('');
    onRefresh();
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
      setEditConcurrencyUserId(null); setEditConcurrencyValue('');
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.error || '修改失败');
    }
  };

  const adminTopUp = async (userId: number) => {
    setTopUpMsg('');
    const num = parseFloat(topUpAmount);
    if (isNaN(num) || num === 0) { setTopUpMsg('金额不能为 0'); return; }
    try {
      await api.post(`/admin/users/${userId}/balance`, { amount: topUpAmount, description: topUpDesc || (num > 0 ? '管理员充值' : '管理员扣费') });
      setTopUpMsg(num > 0 ? '充值成功！' : '扣费成功！');
      setTopUpAmount(''); setTopUpDesc('');
      onRefresh();
      setTimeout(() => { setTopUpUserId(null); setTopUpMsg(''); }, 1500);
    } catch (err: any) {
      setTopUpMsg(err.response?.data?.error || '充值失败');
    }
  };

  const toggleUserStatus = async (userId: number) => {
    await api.put(`/admin/users/${userId}/status`);
    onRefresh();
  };

  const updateProvider = async (userId: number, provider: string) => {
    try {
      await api.put(`/admin/users/${userId}/provider`, { provider });
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.error || '切换失败');
    }
  };

  const toggleUserRecords = async (userId: number) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setUserRecords([]);
    } else {
      setExpandedUserId(userId);
      setIsLoadingRecords(true);
      try {
        const { data } = await api.get(`/admin/users/${userId}/balance-audit`);
        setUserRecords(data.records || []);
      } catch (err: any) {
        alert(err.response?.data?.error || 'Load records failed');
      } finally {
        setIsLoadingRecords(false);
      }
    }
  };

  return (
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
          <tr className="border-b bg-gray-50"><th className="p-2">ID</th><th className="p-2">Username</th><th className="p-2">Role</th><th className="p-2">状态</th><th className="p-2">Provider</th><th className="p-2">余额(元)</th><th className="p-2">并发限制</th><th className="p-2">操作</th></tr>
        </thead>
        <tbody>
          {users.map(u => (
            <React.Fragment key={u.id}>
            <tr className="border-b">
              <td className="p-2">{u.id}</td>
              <td className="p-2">
                <span onClick={() => toggleUserRecords(u.id)} className="cursor-pointer text-blue-600 hover:underline">
                  {u.username}
                </span>
              </td>
              <td className="p-2">{u.role}</td>
              <td className="p-2">
                <button onClick={() => toggleUserStatus(u.id)} className={`inline-block px-2 py-0.5 rounded text-xs font-medium cursor-pointer ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {u.status === 'active' ? '正常' : '已封禁'}
                </button>
              </td>
              <td className="p-2">
                <select
                  value={u.provider || 'meitu'}
                  onChange={e => updateProvider(u.id, e.target.value)}
                  className={`text-xs font-medium px-2 py-1 rounded border cursor-pointer ${u.provider === 'evolink' ? 'bg-purple-50 text-purple-700 border-purple-200' : u.provider === 'auto' ? 'bg-amber-50 text-amber-700 border-amber-200' : u.provider === 'ark' ? 'bg-orange-50 text-orange-700 border-orange-200' : u.provider === 'aivideo' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}
                >
                  <option value="meitu">Meitu</option>
                  <option value="evolink">Evolink</option>
                  <option value="ark">Ark</option>
                  <option value="aivideo">Aivideo</option>
                  <option value="auto">Auto (Meitu→Evolink)</option>
                </select>
              </td>
              <td className="p-2">
                <span className={`font-mono text-sm font-semibold ${parseFloat(u.balance || '0') <= 0 ? 'text-red-600' : 'text-green-600'}`}>¥{parseFloat(u.balance || '0').toFixed(2)}</span>
                {topUpUserId === u.id ? (
                  <div className="flex flex-col gap-1 mt-1">
                    <div className="flex gap-1 items-center">
                      <input type="number" step="0.01" placeholder="金额(负值为扣费)" value={topUpAmount} onChange={e => setTopUpAmount(e.target.value)} className="border px-2 py-1 rounded-md text-sm w-28" />
                      <input type="text" placeholder="备注(可选)" value={topUpDesc} onChange={e => setTopUpDesc(e.target.value)} className="border px-2 py-1 rounded-md text-sm w-24" />
                      <button onClick={() => adminTopUp(u.id)} className="bg-green-600 text-white px-2 py-1 rounded-md text-xs">确认</button>
                      <button onClick={() => { setTopUpUserId(null); setTopUpMsg(''); }} className="text-gray-500 hover:underline text-xs">取消</button>
                    </div>
                    {topUpMsg && <span className={`text-xs ${topUpMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{topUpMsg}</span>}
                  </div>
                ) : (
                <button onClick={() => { setTopUpUserId(u.id); setTopUpAmount(''); setTopUpDesc(''); setTopUpMsg(''); }} className="text-green-600 hover:underline text-xs ml-2">充值/扣费</button>
                )}
              </td>
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
            {expandedUserId === u.id && (
              <tr className="bg-gray-50 border-b">
                <td colSpan={8} className="p-4">
                  <div className="text-sm">
                    <div className="font-semibold mb-2">充值记录 (Balance Audit)</div>
                    {isLoadingRecords ? (
                      <div className="text-gray-500 py-2">Loading...</div>
                    ) : userRecords.length === 0 ? (
                      <div className="text-gray-500 py-2">暂无充值记录</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left bg-white border border-gray-200 rounded">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="p-2 border-b text-xs font-medium text-gray-500">时间</th>
                              <th className="p-2 border-b text-xs font-medium text-gray-500">记录ID</th>
                              <th className="p-2 border-b text-xs font-medium text-gray-500">金额</th>
                              <th className="p-2 border-b text-xs font-medium text-gray-500">操作人</th>
                              <th className="p-2 border-b text-xs font-medium text-gray-500">备注</th>
                            </tr>
                          </thead>
                          <tbody>
                            {userRecords.map(r => (
                              <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                                <td className="p-2 text-gray-600">{new Date(r.createdAt).toLocaleString()}</td>
                                <td className="p-2 text-gray-500">#{r.id}</td>
                                <td className={`p-2 font-mono ${parseFloat(r.amount) > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {parseFloat(r.amount) > 0 ? '+' : ''}{parseFloat(r.amount).toFixed(2)}
                                </td>
                                <td className="p-2 text-gray-600">{r.operatorUsername || 'System'}</td>
                                <td className="p-2 text-gray-600">{r.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {/* Mobile Cards */}
      <div className="md:hidden grid gap-4">
        {users.map(u => (
          <div key={u.id} className="border border-gray-100 rounded-lg p-4 bg-gray-50 shadow-sm flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span onClick={() => toggleUserRecords(u.id)} className="font-semibold text-blue-600 hover:underline cursor-pointer">{u.username}</span>
              <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">ID: {u.id}</span>
            </div>
            <div className="text-sm text-gray-600">Created: {new Date(u.createdAt).toLocaleDateString()}</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Provider:</span>
              <select
                value={u.provider || 'meitu'}
                onChange={e => updateProvider(u.id, e.target.value)}
                className={`text-xs font-medium px-2 py-1 rounded border cursor-pointer ${u.provider === 'evolink' ? 'bg-purple-50 text-purple-700 border-purple-200' : u.provider === 'auto' ? 'bg-amber-50 text-amber-700 border-amber-200' : u.provider === 'ark' ? 'bg-orange-50 text-orange-700 border-orange-200' : u.provider === 'aivideo' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}
              >
                <option value="meitu">Meitu</option>
                <option value="evolink">Evolink</option>
                <option value="ark">Ark</option>
                <option value="aivideo">Aivideo</option>
                <option value="auto">Auto (Meitu→Evolink)</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">余额:</span>
              <span className={`font-mono font-semibold ${parseFloat(u.balance || '0') <= 0 ? 'text-red-600' : 'text-green-600'}`}>¥{parseFloat(u.balance || '0').toFixed(2)}</span>
              {topUpUserId === u.id ? (
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1 items-center">
                    <input type="number" step="0.01" min="0.01" placeholder="金额" value={topUpAmount} onChange={e => setTopUpAmount(e.target.value)} className="border px-2 py-1 rounded-md text-sm w-20" />
                    <input type="text" placeholder="备注" value={topUpDesc} onChange={e => setTopUpDesc(e.target.value)} className="border px-2 py-1 rounded-md text-sm w-24" />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => adminTopUp(u.id)} className="bg-green-600 text-white px-2 py-1 rounded-md text-xs">确认</button>
                    <button onClick={() => { setTopUpUserId(null); setTopUpMsg(''); }} className="text-gray-500 hover:underline text-xs">取消</button>
                  </div>
                  {topUpMsg && <span className={`text-xs ${topUpMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{topUpMsg}</span>}
                </div>
              ) : (
                <button onClick={() => { setTopUpUserId(u.id); setTopUpAmount(''); setTopUpDesc(''); setTopUpMsg(''); }} className="text-green-600 hover:underline text-xs">充值</button>
              )}
            </div>
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
            {/* Mobile Expanded Records */}
            {expandedUserId === u.id && (
              <div className="pt-2 border-t border-gray-200 mt-1">
                <div className="font-semibold mb-2 text-sm text-gray-700">充值记录</div>
                {isLoadingRecords ? (
                  <div className="text-gray-500 text-sm">Loading...</div>
                ) : userRecords.length === 0 ? (
                  <div className="text-gray-500 text-sm">暂无记录</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {userRecords.map(r => (
                      <div key={r.id} className="bg-white p-2 rounded border border-gray-100 text-sm shadow-sm">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-gray-500 text-xs">{new Date(r.createdAt).toLocaleString()}</span>
                          <span className={`font-mono font-medium ${parseFloat(r.amount) > 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {parseFloat(r.amount) > 0 ? '+' : ''}{parseFloat(r.amount).toFixed(2)}
                          </span>
                        </div>
                        <div className="text-gray-700">{r.description}</div>
                        <div className="text-gray-400 text-xs mt-1">操作人: {r.operatorUsername || 'System'} (#{r.id})</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
