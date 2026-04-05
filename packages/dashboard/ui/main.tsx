import { useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { OverviewPage } from './pages/Overview'
import { TestsPage } from './pages/Tests'
import { ApiExplorer } from './pages/ApiExplorer'
import { EnvironmentPage } from './pages/Environment'
import { ProjectsPage } from './pages/Projects'
import { TrendsPage } from './pages/TrendsPage'
import { health, projects, type ProjectEntry } from './lib/api'

type Page = 'overview' | 'tests' | 'trends' | 'api' | 'environment' | 'projects'

function App() {
  const [page, setPage] = useState<Page>('overview')
  const [projectName, setProjectName] = useState('')
  const [projectVersion, setProjectVersion] = useState('')

  const [projectList, setProjectList] = useState<ProjectEntry[]>([])
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [switching, setSwitching] = useState(false)

  const loadInfo = useCallback(async () => {
    try {
      const [healthRes, projRes] = await Promise.all([
        health.dashboard(),
        projects.list(),
      ])
      if (healthRes.project) setProjectName(healthRes.project)
      if (healthRes.version) setProjectVersion(healthRes.version)
      setProjectList(projRes.projects)
      setActiveProjectName(projRes.activeProject)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadInfo() }, [loadInfo])

  const switchProject = async (name: string) => {
    setSwitching(true)
    setShowProjectDropdown(false)
    try {
      const res = await projects.activate(name)
      if (res.success) {
        await handleProjectSwitch()
      }
    } catch { /* ignore */ }
    setSwitching(false)
  }

  const [refreshKey, setRefreshKey] = useState(0)

  const handleProjectSwitch = useCallback(async () => {
    await loadInfo()
    setRefreshKey(k => k + 1)
  }, [loadInfo])

  const handleNavigate = useCallback((target: string) => {
    setPage(target as Page)
  }, [])

  const primaryPages: { key: Page; label: string; icon: string }[] = [
    { key: 'overview', label: '总览', icon: '📊' },
    { key: 'tests', label: '测试套件', icon: '🧪' },
    { key: 'trends', label: '趋势分析', icon: '📈' },
    { key: 'api', label: 'API 调试', icon: '🔌' },
    { key: 'environment', label: '环境管理', icon: '🚀' },
  ]

  const secondaryPages: { key: Page; label: string; icon: string }[] = [
    { key: 'projects', label: '项目', icon: '📂' },
  ]

  return (
    <div className="h-screen overflow-hidden">
      <div className="flex h-screen">
        {/* Sidebar */}
        <nav className="w-48 bg-gray-900 text-white flex flex-col shrink-0">
          {/* Project Selector */}
          <div className="p-4 border-b border-gray-700 relative">
            <button
              onClick={() => setShowProjectDropdown(!showProjectDropdown)}
              className="w-full text-left group"
              disabled={switching}
            >
              <h1 className="text-lg font-bold flex items-center gap-1">
                {switching ? (
                  <span className="text-gray-400">切换中...</span>
                ) : (
                  <>
                    <span className="truncate">{projectName || 'ArgusAI'}</span>
                    <span className="text-gray-500 text-xs group-hover:text-gray-300 transition-colors">
                      {projectList.length > 1 ? '▼' : ''}
                    </span>
                  </>
                )}
              </h1>
              <p className="text-xs text-gray-400 mt-1">E2E 测试仪表盘</p>
            </button>

            {showProjectDropdown && projectList.length > 0 && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowProjectDropdown(false)}
                />
                <div className="absolute left-2 right-2 top-full mt-1 bg-gray-800 rounded-lg shadow-xl border border-gray-600 z-20 overflow-hidden">
                  <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">切换项目</div>
                  {projectList.map(p => (
                    <button
                      key={p.name}
                      onClick={() => switchProject(p.name)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                        p.name === activeProjectName
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        p.name === activeProjectName ? 'bg-white' : 'bg-gray-500'
                      }`} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => { setShowProjectDropdown(false); setPage('projects') }}
                    className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-gray-700 border-t border-gray-700 transition-colors"
                  >
                    管理项目...
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Primary nav */}
          <div className="flex-1 py-2">
            {primaryPages.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setPage(key)}
                className={`w-full text-left px-4 py-3 text-sm flex items-center gap-2.5 transition-colors ${
                  page === key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Secondary nav */}
          <div className="py-2 border-t border-gray-700">
            {secondaryPages.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setPage(key)}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                  page === key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <span>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
            {projectVersion ? `v${projectVersion}` : 'ArgusAI Dashboard'}
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-hidden bg-gray-50 relative">
          <div className="absolute inset-0 overflow-auto" style={{ display: page === 'overview' ? 'block' : 'none' }}>
            <OverviewPage key={`overview-${refreshKey}`} onNavigate={handleNavigate} />
          </div>
          <div className="absolute inset-0 overflow-auto" style={{ display: page === 'tests' ? 'block' : 'none' }}>
            <TestsPage key={`tests-${refreshKey}`} />
          </div>
          <div className="absolute inset-0 overflow-auto" style={{ display: page === 'trends' ? 'block' : 'none' }}>
            <TrendsPage key={`trends-${refreshKey}`} />
          </div>
          <div className="absolute inset-0 overflow-auto" style={{ display: page === 'api' ? 'block' : 'none' }}>
            <ApiExplorer key={`api-${refreshKey}`} />
          </div>
          <div className="absolute inset-0 overflow-auto" style={{ display: page === 'environment' ? 'block' : 'none' }}>
            <EnvironmentPage key={`env-${refreshKey}`} />
          </div>
          <div className="absolute inset-0 overflow-auto" style={{ display: page === 'projects' ? 'block' : 'none' }}>
            <ProjectsPage key={`proj-${refreshKey}`} onProjectSwitch={handleProjectSwitch} />
          </div>
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
