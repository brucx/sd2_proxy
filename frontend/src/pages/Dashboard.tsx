import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/panel' });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function Dashboard() {
  const navigate = useNavigate();
  const role = localStorage.getItem('role');
  const [keys, setKeys] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
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
        const [usersRes, usageRes, keysRes] = await Promise.all([
          api.get('/admin/users'),
          api.get('/admin/usage'),
          api.get('/admin/keys')
        ]);
        setUsers(usersRes.data);
        setUsage(usageRes.data);
        setAdminKeys(keysRes.data);
      } else {
        const [keysRes, usageRes] = await Promise.all([
          api.get('/keys'),
          api.get('/usage')
        ]);
        setKeys(keysRes.data);
        setUsage(usageRes.data);
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate('/login');
      }
    }
  };

  const createKey = async () => {
    if (!newKeyName) return;
    await api.post('/keys', { name: newKeyName });
    setNewKeyName('');
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

  const logout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8 bg-white p-4 rounded-xl shadow-sm">
        <h1 className="text-3xl font-bold text-gray-800">API Proxy Dashboard</h1>
        <div className="space-x-4">
          <Link to="/playground" className="text-blue-600 hover:underline font-medium">API Playground</Link>
          <button onClick={() => setShowChangePwd(!showChangePwd)} className="text-indigo-600 hover:underline font-medium">修改密码</button>
          <button onClick={logout} className="text-red-500 hover:underline font-medium">Logout</button>
        </div>
      </div>

      {/* Change Own Password Section */}
      {showChangePwd && (
        <div className="bg-white p-6 rounded-xl shadow-sm mb-8">
          <h2 className="text-xl font-bold mb-4">修改密码</h2>
          <div className="flex gap-4 items-end flex-wrap">
            <div>
              <label className="block text-sm text-gray-600 mb-1">旧密码</label>
              <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} className="border px-3 py-2 rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">新密码</label>
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} className="border px-3 py-2 rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">确认新密码</label>
              <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} className="border px-3 py-2 rounded-md" />
            </div>
            <button onClick={changeOwnPassword} className="bg-indigo-600 text-white px-4 py-2 rounded-md h-fit">确认修改</button>
          </div>
          {pwdMsg && <p className={`mt-3 text-sm font-medium ${pwdMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{pwdMsg}</p>}
        </div>
      )}

      {role === 'admin' ? (
        <div className="space-y-8">
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">Users Management</h2>
            <div className="flex gap-4 mb-4">
              <input type="text" placeholder="Username" value={newUserName} onChange={e => setNewUserName(e.target.value)} className="border px-3 py-2 rounded-md" />
              <input type="password" placeholder="Password" value={newUserPass} onChange={e => setNewUserPass(e.target.value)} className="border px-3 py-2 rounded-md" />
              <button onClick={createUser} className="bg-blue-600 text-white px-4 py-2 rounded-md">Create Tenant</button>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">ID</th><th className="p-2">Username</th><th className="p-2">Role</th><th className="p-2">操作</th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b">
                    <td className="p-2">{u.id}</td>
                    <td className="p-2">{u.username}</td>
                    <td className="p-2">{u.role}</td>
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
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">Key 管理</h2>
            <div className="flex gap-4 mb-4 items-end">
              <div>
                <label className="block text-sm text-gray-600 mb-1">用户</label>
                <select value={adminKeyUserId} onChange={e => setAdminKeyUserId(e.target.value ? parseInt(e.target.value) : '')} className="border px-3 py-2 rounded-md">
                  <option value="">选择用户</option>
                  {users.filter(u => u.role === 'tenant').map(u => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Key 名称</label>
                <input type="text" placeholder="Key Name" value={adminKeyName} onChange={e => setAdminKeyName(e.target.value)} className="border px-3 py-2 rounded-md" />
              </div>
              <button onClick={createAdminKey} className="bg-blue-600 text-white px-4 py-2 rounded-md h-fit">创建 Key</button>
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">用户</th><th className="p-2">名称</th><th className="p-2">API Key</th><th className="p-2">状态</th><th className="p-2">创建时间</th><th className="p-2">操作</th></tr>
              </thead>
              <tbody>
                {adminKeys.map(k => (
                  <tr key={k.id} className="border-b">
                    <td className="p-2">{k.username}</td>
                    <td className="p-2">{k.name}</td>
                    <td className="p-2 font-mono text-xs text-gray-600">{k.apiKey}</td>
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
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">Global Usage Statistics (Tokens)</h2>
            <p className="mb-4 font-medium text-lg">Total Completion Tokens: {usage.reduce((acc, curr) => acc + curr.completionTokens, 0)}</p>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">User ID</th><th className="p-2">Key ID</th><th className="p-2">Task ID</th><th className="p-2">Tokens</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody>
                {usage.map(u => (
                  <tr key={u.id} className="border-b"><td className="p-2">{u.userId}</td><td className="p-2">{u.keyId}</td><td className="p-2 font-mono text-xs">{u.taskId}</td><td className="p-2">{u.completionTokens}</td><td className="p-2">{u.status}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">API Keys</h2>
            <div className="flex gap-4 mb-4">
              <input type="text" placeholder="Key Name" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} className="border px-3 py-2 rounded-md flex-1" />
              <button onClick={createKey} className="bg-blue-600 text-white px-4 py-2 rounded-md">Create Key</button>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">Name</th><th className="p-2">API Key</th><th className="p-2">Created</th></tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-b"><td className="p-2">{k.name}</td><td className="p-2 font-mono text-sm text-gray-600">{k.apiKey}</td><td className="p-2 text-sm">{new Date(k.createdAt).toLocaleDateString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold mb-4">Usage Statistics</h2>
            <p className="mb-4 font-medium text-lg text-green-700 bg-green-50 p-3 rounded-lg border border-green-200 inline-block">
              Total Used Tokens: {usage.reduce((acc, curr) => acc + curr.completionTokens, 0)}
            </p>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50"><th className="p-2">Endpoint</th><th className="p-2">Task ID</th><th className="p-2">Tokens</th><th className="p-2">Status</th><th className="p-2">Time</th></tr>
              </thead>
              <tbody>
                {usage.map(u => (
                  <tr key={u.id} className="border-b"><td className="p-2">{u.endpoint}</td><td className="p-2 font-mono text-xs">{u.taskId}</td><td className="p-2 font-semibold">{u.completionTokens}</td><td className="p-2">{u.status}</td><td className="p-2">{new Date(u.createdAt).toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;

