import { useState, useEffect } from 'react';
import { getStoredTeams, switchTeam, clearApiKey, type TeamEntry } from '../api/client';

interface TeamSelectorProps {
  currentTeamName: string;
  onSwitch: () => void;
  onLogout: () => void;
}

export function TeamSelector({ currentTeamName, onSwitch, onLogout }: TeamSelectorProps) {
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTeams(getStoredTeams());
  }, []);

  const handleSwitch = (team: TeamEntry) => {
    switchTeam(team.apiKey);
    setOpen(false);
    onSwitch();
  };

  const handleLogout = () => {
    clearApiKey();
    setOpen(false);
    onLogout();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors w-full text-left px-3 py-2 rounded-lg hover:bg-gray-800"
      >
        <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
        <span className="truncate flex-1">{currentTeamName}</span>
        {teams.length > 1 && <span className="text-gray-500 text-xs">▼</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 rounded-lg shadow-xl border border-gray-600 z-20 overflow-hidden">
            {teams.length > 1 && (
              <>
                <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
                  切换团队
                </div>
                {teams.map((team) => (
                  <button
                    key={team.apiKey}
                    onClick={() => handleSwitch(team)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                      team.name === currentTeamName
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      team.name === currentTeamName ? 'bg-white' : 'bg-gray-500'
                    }`} />
                    <span className="truncate flex-1">{team.name}</span>
                    <span className="text-xs text-gray-500 font-mono">{team.apiKeyPrefix}...</span>
                  </button>
                ))}
              </>
            )}
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-gray-700 border-t border-gray-700 transition-colors"
            >
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  );
}
