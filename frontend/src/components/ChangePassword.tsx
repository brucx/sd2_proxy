import { useState } from 'react';
import { api } from '../api';

interface ChangePasswordProps {
  onClose: () => void;
}

export default function ChangePassword({ onClose }: ChangePasswordProps) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');

  const changeOwnPassword = async () => {
    setPwdMsg('');
    if (!oldPwd || !newPwd) { setPwdMsg('请填写所有字段'); return; }
    if (newPwd !== confirmPwd) { setPwdMsg('两次输入的新密码不一致'); return; }
    try {
      await api.put('/me/password', { oldPassword: oldPwd, newPassword: newPwd });
      setPwdMsg('密码修改成功！');
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      setTimeout(() => { onClose(); setPwdMsg(''); }, 1500);
    } catch (err: any) {
      setPwdMsg(err.response?.data?.error || '修改失败');
    }
  };

  return (
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
  );
}
