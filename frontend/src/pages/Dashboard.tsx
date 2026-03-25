import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';

import ChangePassword from '../components/ChangePassword';
import AdminUsersPanel from '../components/AdminUsersPanel';
import AdminKeysPanel from '../components/AdminKeysPanel';
import UsagePanel from '../components/UsagePanel';
import RequestLogsPanel from '../components/RequestLogsPanel';
import TenantDashboard from '../components/TenantDashboard';

function Dashboard() {
  const navigate = useNavigate();
  const role = localStorage.getItem('role');

  const [showChangePwd, setShowChangePwd] = useState(false);

  // Admin state
  const [users, setUsers] = useState<any[]>([]);
  const [adminKeys, setAdminKeys] = useState<any[]>([]);

  // Tenant state
  const [keys, setKeys] = useState<any[]>([]);
  const [whitelist, setWhitelist] = useState<any[]>([]);
  const [tenantBalance, setTenantBalance] = useState<{
    balance: string; totalTopUp: string; totalConsumed: string;
    concurrencyLimit: number; activeConcurrency: number;
  } | null>(null);
  const [rechargeRecords, setRechargeRecords] = useState<any[]>([]);
  const [rechargeTotal, setRechargeTotal] = useState(0);
  const [rechargePage, setRechargePage] = useState(1);
  const [rechargePageSize] = useState(10);

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
          api.get('/admin/keys'),
        ]);
        setUsers(usersRes.data);
        setAdminKeys(keysRes.data);
      } else {
        const [keysRes, whitelistRes, balanceRes] = await Promise.all([
          api.get('/keys'),
          api.get('/whitelist'),
          api.get('/balance'),
        ]);
        setKeys(keysRes.data);
        setWhitelist(whitelistRes.data);
        setTenantBalance(balanceRes.data);
        fetchRechargeRecords();
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.clear();
        navigate('/login');
      }
    }
  };

  const fetchRechargeRecords = async (page = rechargePage) => {
    try {
      const res = await api.get('/balance/records', { params: { page, pageSize: rechargePageSize } });
      setRechargeRecords(res.data.records);
      setRechargeTotal(res.data.total);
      setRechargePage(res.data.page);
    } catch (err) {
      console.error('Failed to fetch recharge records', err);
    }
  };

  const logout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 bg-white p-4 rounded-xl shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">API Proxy Dashboard</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">{localStorage.getItem('username') || ''}</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link to="/playground" className="text-blue-600 hover:underline font-medium">API Playground</Link>
          <button onClick={() => setShowChangePwd(!showChangePwd)} className="text-indigo-600 hover:underline font-medium">修改密码</button>
          <button onClick={logout} className="text-red-500 hover:underline font-medium">Logout</button>
        </div>
      </div>

      {showChangePwd && <ChangePassword onClose={() => setShowChangePwd(false)} />}

      {role === 'admin' ? (
        <div className="space-y-8">
          <AdminUsersPanel users={users} onRefresh={fetchData} />
          <AdminKeysPanel adminKeys={adminKeys} users={users} onRefresh={fetchData} />
          <UsagePanel role="admin" users={users} />
          <RequestLogsPanel users={users} />
        </div>
      ) : (
        <div className="space-y-8">
          <TenantDashboard
            keys={keys}
            whitelist={whitelist}
            tenantBalance={tenantBalance}
            rechargeRecords={rechargeRecords}
            rechargeTotal={rechargeTotal}
            rechargePage={rechargePage}
            rechargePageSize={rechargePageSize}
            onRefresh={fetchData}
            onFetchRechargeRecords={fetchRechargeRecords}
          />
          <UsagePanel role="tenant" keys={keys} />
        </div>
      )}
    </div>
  );
}

export default Dashboard;
