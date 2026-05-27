import { useState } from 'react';
import { setApiKey, addStoredTeam, serverApi } from '../api/client';

interface LoginScreenProps {
  onLogin: () => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [apiKey, setApiKeyState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setLoading(true);
    setError(null);

    try {
      setApiKey(apiKey.trim());
      const res = await serverApi.getTeam();
      if (res.success && res.team) {
        addStoredTeam({
          name: res.team.name,
          apiKeyPrefix: res.team.apiKeyPrefix,
          apiKey: apiKey.trim(),
        });
        onLogin();
      } else {
        setError('无法验证 API Key，请检查后重试');
      }
    } catch {
      setError('连接失败或 API Key 无效');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🎯</div>
          <h1 className="text-2xl font-bold text-gray-900">ArgusAI Server</h1>
          <p className="text-gray-500 mt-2">输入团队 API Key 连接到服务器</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="mb-4">
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKeyState(e.target.value)}
              placeholder="输入 64 位 API Key..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              autoComplete="off"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '连接中...' : '连接'}
          </button>

          <p className="mt-4 text-xs text-gray-400 text-center">
            API Key 由团队管理员通过 <code className="bg-gray-100 px-1 rounded">POST /api/teams</code> 创建
          </p>
        </form>
      </div>
    </div>
  );
}
