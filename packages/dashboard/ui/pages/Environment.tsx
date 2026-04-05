import { useState } from 'react'
import { ContainerPage } from './Container'
import { LogsPage } from './Logs'
import { BuildPage } from './Build'

type Tab = 'container' | 'logs' | 'build'

export function EnvironmentPage() {
  const [tab, setTab] = useState<Tab>('container')

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'container', label: '容器状态', icon: '🚀' },
    { key: 'logs', label: '容器日志', icon: '📋' },
    { key: 'build', label: '镜像构建', icon: '🔨' },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="border-b bg-white px-6 pt-4">
        <h2 className="text-xl font-bold text-gray-800 mb-3">环境管理</h2>
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
                tab === t.key
                  ? 'bg-gray-50 text-blue-600 font-medium border-t border-x border-gray-200'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'container' && <ContainerPage />}
        {tab === 'logs' && <LogsPage />}
        {tab === 'build' && <BuildPage />}
      </div>
    </div>
  )
}
