import { useEffect, useState } from 'react';
import { listUsers, type AppUser } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

export default function UsersPage() {
  const [rows, setRows] = useState<AppUser[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listUsers()
      .then((data) => setRows(data.items))
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, []);

  return (
    <div className="panel wide">
      <h1>账号</h1>
      <p className="sub">借款人可自助注册；银行员工账号由管理员创建。此页只读。</p>
      {error ? <Notice>{error}</Notice> : null}
      <table className="grid compact">
        <thead>
          <tr><th>用户名</th><th>显示名</th><th>角色</th><th>状态</th><th>最近登录</th></tr>
        </thead>
        <tbody>
          {rows.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.display_name ?? '—'}</td>
              <td>{user.role === 'banker' ? (user.is_admin ? '银行管理员' : '银行员工') : '借款人'}</td>
              <td>{user.status === 'active' ? '正常' : user.status}</td>
              <td className="small muted">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
