import { useState, useCallback } from 'react'
import type { RunRecord } from '../lib/api'

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

interface Props {
  runs: RunRecord[]
  hasMore: boolean
  loading?: boolean
  onLoadMore?: () => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

const TRIGGER_ICON: Record<string, string> = {
  cli: '⌨',
  mcp: '🤖',
  dashboard: '🖥',
  ci: '⚙',
}

const STATUS_ICON: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  skipped: '○',
}

export function RunTimeline({ runs, hasMore, loading, onLoadMore }: Props) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({})
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null)

  const toggleRunDetail = useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null)
      return
    }

    setExpandedRunId(runId)

    if (runDetails[runId]) return

    setLoadingDetail(runId)
    try {
      const res = await fetch(`/api/runs/${runId}`)
      const data = await res.json()
      if (data.success) {
        setRunDetails(prev => ({ ...prev, [runId]: data }))
      }
    } catch {
      // silently fail
    } finally {
      setLoadingDetail(null)
    }
  }, [expandedRunId, runDetails])

  if (loading && !runs.length) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">运行历史</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">加载中...</div>
      </div>
    )
  }

  if (!runs.length) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">运行历史</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">暂无运行记录</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">运行历史</h3>
      <div className="space-y-0 relative max-h-[800px] overflow-y-auto">
        <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-200" />

        {runs.map(run => {
          const isPassed = run.status === 'passed'
          const total = run.passed + run.failed + run.skipped
          const isExpanded = expandedRunId === run.id
          const detail = runDetails[run.id]
          const isLoadingThis = loadingDetail === run.id

          return (
            <div key={run.id} className="relative pl-8 pb-4">
              <div className={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 border-white ${
                isPassed ? 'bg-green-500' : 'bg-red-500'
              }`} />

              <button
                onClick={() => toggleRunDetail(run.id)}
                className="w-full text-left hover:bg-gray-50 rounded-lg p-2 -ml-2 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-gray-500">{formatTime(run.timestamp)}</span>
                      <span className="text-xs text-gray-400">{formatDuration(run.duration)}</span>
                      {run.gitBranch && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                          {run.gitBranch}
                        </span>
                      )}
                      <span className="text-xs" title={`Trigger: ${run.trigger}`}>
                        {TRIGGER_ICON[run.trigger] ?? '?'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-xs">
                      <span className="text-green-600">{run.passed} 通过</span>
                      {run.failed > 0 && <span className="text-red-600">{run.failed} 失败</span>}
                      {run.skipped > 0 && <span className="text-gray-400">{run.skipped} 跳过</span>}
                      {run.flaky > 0 && <span className="text-yellow-600">{run.flaky} flaky</span>}
                    </div>

                    {total > 0 && (
                      <div className="flex h-1.5 w-full max-w-xs mt-1.5 rounded-full overflow-hidden bg-gray-100">
                        <div className="bg-green-500" style={{ width: `${(run.passed / total) * 100}%` }} />
                        <div className="bg-red-500" style={{ width: `${(run.failed / total) * 100}%` }} />
                        <div className="bg-gray-300" style={{ width: `${(run.skipped / total) * 100}%` }} />
                      </div>
                    )}
                  </div>

                  <span className={`text-gray-400 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-2 ml-2 border-l-2 border-gray-100 pl-3">
                  {isLoadingThis ? (
                    <div className="text-xs text-gray-400 py-2">加载用例详情...</div>
                  ) : detail ? (
                    <div className="space-y-0.5">
                      {(() => {
                        const grouped = new Map<string, CaseRecord[]>()
                        for (const c of detail.cases) {
                          const key = c.suiteId
                          if (!grouped.has(key)) grouped.set(key, [])
                          grouped.get(key)!.push(c)
                        }

                        return Array.from(grouped.entries()).map(([suiteId, cases]) => (
                          <div key={suiteId} className="mb-2">
                            <div className="text-xs font-medium text-gray-600 py-1 flex items-center gap-1">
                              <span className="text-gray-400">▸</span>
                              {suiteId}
                              <span className="text-gray-400 ml-1">
                                ({cases.filter(c => c.status === 'passed').length}/{cases.length})
                              </span>
                            </div>
                            {cases.map(c => (
                              <div key={c.id} className="flex items-start gap-1.5 py-0.5 pl-3 text-xs">
                                <span className={
                                  c.status === 'passed' ? 'text-green-500' :
                                  c.status === 'failed' ? 'text-red-500' : 'text-gray-400'
                                }>
                                  {STATUS_ICON[c.status] ?? '?'}
                                </span>
                                <span className="text-gray-700 flex-1">{c.caseName}</span>
                                <span className="text-gray-400 tabular-nums">{formatDuration(c.duration)}</span>
                                {c.error && (
                                  <details className="w-full mt-0.5">
                                    <summary className="text-red-500 cursor-pointer text-[11px]">错误详情</summary>
                                    <pre className="bg-red-50 text-red-700 p-2 rounded text-[11px] mt-1 whitespace-pre-wrap max-h-32 overflow-auto">
                                      {c.error}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        ))
                      })()}

                      <div className="pt-2 border-t border-gray-100 mt-2 flex items-center gap-4 text-[11px] text-gray-400">
                        {run.gitCommit && (
                          <span className="font-mono">commit: {run.gitCommit.slice(0, 8)}</span>
                        )}
                        <span>ID: {run.id}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 py-2">无法加载详情</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loading}
          className="mt-3 w-full py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
        >
          {loading ? '加载中...' : '加载更多'}
        </button>
      )}
    </div>
  )
}
