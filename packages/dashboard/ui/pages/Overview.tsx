import { useState, useEffect, useCallback } from 'react'
import { runs, tests, type RunRecord } from '../lib/api'

interface CaseRecord {
  id: string
  runId: string
  suiteId: string
  caseName: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  attempts: number
  error: string | null
}

interface RunDetail {
  run: RunRecord
  cases: CaseRecord[]
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
}

const TRIGGER_LABELS: Record<string, string> = {
  cli: 'CLI',
  dashboard: 'Dashboard',
  mcp: 'MCP',
  ci: 'CI',
}

interface Props {
  onNavigate: (page: string) => void
}

export function OverviewPage({ onNavigate }: Props) {
  const [latestRun, setLatestRun] = useState<RunRecord | null>(null)
  const [runHistory, setRunHistory] = useState<RunRecord[]>([])
  const [suiteCount, setSuiteCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({})
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      runs.list(10).catch(() => ({ runs: [], pagination: { total: 0 } })),
      tests.getSuites().catch(() => ({ suites: [] })),
    ]).then(([runRes, suitesRes]) => {
      setRunHistory(runRes.runs)
      if (runRes.runs.length > 0) setLatestRun(runRes.runs[0]!)
      setSuiteCount(suitesRes.suites.length)
      setLoading(false)
    })
  }, [])

  const toggleRunDetail = useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null)
      return
    }
    setExpandedRunId(runId)
    if (runDetails[runId]) return

    setLoadingDetail(runId)
    try {
      const res = await runs.detail(runId)
      if (res.success) {
        setRunDetails(prev => ({ ...prev, [runId]: res as unknown as RunDetail }))
      }
    } catch { /* */ } finally {
      setLoadingDetail(null)
    }
  }, [expandedRunId, runDetails])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">加载中...</div>
      </div>
    )
  }

  const total = latestRun ? latestRun.passed + latestRun.failed + latestRun.skipped : 0
  const passRate = total > 0 ? ((latestRun!.passed / total) * 100) : 0

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">测试总览</h2>
        <p className="text-sm text-gray-500 mt-1">
          共 {suiteCount} 个测试套件 · {runHistory.length > 0 ? `最近 ${runHistory.length} 次运行` : '暂无运行记录'}
        </p>
      </div>

      {latestRun ? (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">通过</div>
              <div className="text-3xl font-bold text-green-600">{latestRun.passed}</div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">失败</div>
              <div className={`text-3xl font-bold ${latestRun.failed > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                {latestRun.failed}
              </div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">通过率</div>
              <div className={`text-3xl font-bold ${passRate === 100 ? 'text-green-600' : passRate >= 90 ? 'text-yellow-600' : 'text-red-600'}`}>
                {passRate.toFixed(0)}%
              </div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">耗时</div>
              <div className="text-3xl font-bold text-gray-700">{formatDuration(latestRun.duration)}</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  latestRun.status === 'passed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {latestRun.status === 'passed' ? '✓ 全部通过' : '✗ 有失败'}
                </span>
                <span className="text-sm text-gray-500">{formatTime(latestRun.timestamp)}</span>
                {latestRun.gitBranch && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                    {latestRun.gitBranch}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  via {TRIGGER_LABELS[latestRun.trigger] ?? latestRun.trigger}
                </span>
              </div>
            </div>
            <div className="flex h-3 w-full rounded-full overflow-hidden bg-gray-100">
              <div className="bg-green-500 transition-all" style={{ width: `${(latestRun.passed / total) * 100}%` }} />
              <div className="bg-red-500 transition-all" style={{ width: `${(latestRun.failed / total) * 100}%` }} />
              <div className="bg-gray-300 transition-all" style={{ width: `${(latestRun.skipped / total) * 100}%` }} />
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />{latestRun.passed} 通过</span>
              {latestRun.failed > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{latestRun.failed} 失败</span>}
              {latestRun.skipped > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" />{latestRun.skipped} 跳过</span>}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => onNavigate('tests')}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              查看测试套件
            </button>
            <button
              onClick={() => onNavigate('api')}
              className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border hover:bg-gray-50 transition-colors"
            >
              API 调试
            </button>
            <button
              onClick={() => onNavigate('environment')}
              className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border hover:bg-gray-50 transition-colors"
            >
              容器环境
            </button>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl border p-12 text-center">
          <div className="text-6xl mb-4">🧪</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">暂无测试运行记录</h3>
          <p className="text-sm text-gray-500 mb-6">使用 argusai run 运行测试，结果会自动显示在这里</p>
          <button
            onClick={() => onNavigate('tests')}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            查看测试套件
          </button>
        </div>
      )}

      {/* Run History */}
      {runHistory.length > 0 && (
        <div className="bg-white rounded-xl border">
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">运行历史</h3>
            <span className="text-xs text-gray-400">{runHistory.length} 条记录</span>
          </div>
          <div className="divide-y max-h-[500px] overflow-auto">
            {runHistory.map(run => {
              const isPassed = run.status === 'passed'
              const runTotal = run.passed + run.failed + run.skipped
              const isExpanded = expandedRunId === run.id
              const detail = runDetails[run.id]
              const isLoadingThis = loadingDetail === run.id

              return (
                <div key={run.id}>
                  <button
                    onClick={() => toggleRunDetail(run.id)}
                    className="w-full px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isPassed ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm text-gray-500 w-28 shrink-0">{formatTime(run.timestamp)}</span>
                    <span className={`text-sm font-medium w-24 shrink-0 ${isPassed ? 'text-green-600' : 'text-red-600'}`}>
                      {run.passed}/{runTotal}
                    </span>
                    <span className="text-xs text-gray-400 w-16 shrink-0">{formatDuration(run.duration)}</span>
                    {run.gitBranch && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono shrink-0">
                        {run.gitBranch}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 shrink-0">
                      {TRIGGER_LABELS[run.trigger] ?? run.trigger}
                    </span>
                    <span className="ml-auto text-gray-400 text-xs">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-4 bg-gray-50">
                      {isLoadingThis ? (
                        <div className="text-xs text-gray-400 py-3">加载用例详情...</div>
                      ) : detail ? (
                        <div className="space-y-2 pt-2">
                          {(() => {
                            const grouped = new Map<string, CaseRecord[]>()
                            for (const c of detail.cases) {
                              if (!grouped.has(c.suiteId)) grouped.set(c.suiteId, [])
                              grouped.get(c.suiteId)!.push(c)
                            }
                            return Array.from(grouped.entries()).map(([suiteId, cases]) => (
                              <details key={suiteId} className="bg-white rounded-lg border" open={cases.some(c => c.status === 'failed')}>
                                <summary className="px-3 py-2 cursor-pointer flex items-center gap-2 text-sm hover:bg-gray-50">
                                  <span className={cases.every(c => c.status !== 'failed') ? 'text-green-500' : 'text-red-500'}>
                                    {cases.every(c => c.status !== 'failed') ? '✓' : '✗'}
                                  </span>
                                  <span className="font-medium text-gray-700">{suiteId}</span>
                                  <span className="text-xs text-gray-400">
                                    {cases.filter(c => c.status === 'passed').length}/{cases.length}
                                  </span>
                                </summary>
                                <div className="px-3 pb-2 space-y-0.5">
                                  {cases.map(c => (
                                    <div key={c.id} className="flex items-center gap-2 py-0.5 text-xs pl-5">
                                      <span className={
                                        c.status === 'passed' ? 'text-green-500' :
                                        c.status === 'failed' ? 'text-red-500' : 'text-gray-400'
                                      }>
                                        {c.status === 'passed' ? '✓' : c.status === 'failed' ? '✗' : '○'}
                                      </span>
                                      <span className="text-gray-600 flex-1">{c.caseName}</span>
                                      <span className="text-gray-400 tabular-nums">{formatDuration(c.duration)}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ))
                          })()}
                          <div className="flex gap-4 text-[11px] text-gray-400 pt-1">
                            {run.gitCommit && <span className="font-mono">commit: {run.gitCommit.slice(0, 8)}</span>}
                            <span>ID: {run.id}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400 py-3">无法加载详情</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
