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
  const [newKeyName, setNewKeyName] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPass, setNewUserPass] = useState('');

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
        const [usersRes, usageRes] = await Promise.all([
          api.get('/admin/users'),
          api.get('/admin/usage')
        ]);
        setUsers(usersRes.data);
        setUsage(usageRes.data);
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
          <button onClick={logout} className="text-red-500 hover:underline font-medium">Logout</button>
        </div>
      </div>

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
                <tr className="border-b bg-gray-50"><th className="p-2">ID</th><th className="p-2">Username</th><th className="p-2">Role</th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b"><td className="p-2">{u.id}</td><td className="p-2">{u.username}</td><td className="p-2">{u.role}</td></tr>
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
