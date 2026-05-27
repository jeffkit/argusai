import { useState, useEffect, useCallback } from 'react';
import { serverApi } from '../api/client';

interface ProjectInfo {
  id: string;
  name: string;
  description: string | null;
  totalRuns: number;
  lastSyncAt: string | null;
  lastRunStatus: string | null;
  lastPassRate: number | null;
  createdAt: string;
}

interface ProjectListProps {
  onSelectProject: (name: string) => void;
}

export function ProjectList({ onSelectProject }: ProjectListProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await serverApi.getProjects();
      if (res.success) {
        setProjects(res.projects);
      } else {
        setError('加载项目列表失败');
      }
    } catch (err) {
      setError(`加载失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">项目列表</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-2/3 mb-3" />
              <div className="h-4 bg-gray-100 rounded w-1/2 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">项目列表</h2>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={fetchProjects} className="ml-3 text-red-600 underline hover:text-red-800">
            重试
          </button>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">项目列表</h2>
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">暂无项目</h3>
          <p className="text-gray-500 max-w-md mx-auto mb-6">
            当团队成员在本地项目配置中添加 <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">server</code> 段并运行测试后，项目会自动注册到这里。
          </p>
          <pre className="text-left inline-block bg-gray-900 text-green-400 rounded-lg p-4 text-sm">
{`# e2e.yaml
server:
  url: "https://your-server.com"
  apiKey: "\${ARGUSAI_API_KEY}"
  team: "your-team"
  sync: auto`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">项目列表</h2>
          <p className="text-sm text-gray-500 mt-1">{projects.length} 个项目</p>
        </div>
        <button
          onClick={fetchProjects}
          className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => onSelectProject(project.name)}
            className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate">
                {project.name}
              </h3>
              <StatusBadge status={project.lastRunStatus} />
            </div>

            {project.description && (
              <p className="text-sm text-gray-500 mb-3 line-clamp-2">{project.description}</p>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
              <div>
                <span className="text-gray-400">运行次数:</span>{' '}
                <span className="font-medium text-gray-700">{project.totalRuns}</span>
              </div>
              <div>
                <span className="text-gray-400">通过率:</span>{' '}
                <span className={`font-medium ${getPassRateColor(project.lastPassRate)}`}>
                  {project.lastPassRate !== null ? `${project.lastPassRate}%` : '—'}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-400">最后同步:</span>{' '}
                <span className="font-medium text-gray-600">
                  {project.lastSyncAt ? formatRelativeTime(project.lastSyncAt) : '—'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const colors = status === 'passed'
    ? 'bg-green-100 text-green-700'
    : 'bg-red-100 text-red-700';

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors}`}>
      {status === 'passed' ? '通过' : '失败'}
    </span>
  );
}

function getPassRateColor(rate: number | null): string {
  if (rate === null) return 'text-gray-500';
  if (rate >= 95) return 'text-green-600';
  if (rate >= 80) return 'text-yellow-600';
  return 'text-red-600';
}

function formatRelativeTime(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}
