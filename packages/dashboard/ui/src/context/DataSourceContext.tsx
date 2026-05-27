import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { isAuthRequired, isAuthenticated, serverApi } from '../api/client';

export type DataSourceMode = 'local' | 'server';

interface DataSourceState {
  mode: DataSourceMode;
  authenticated: boolean;
  teamName: string | null;
  teamId: string | null;
  selectedProject: string | null;
  setSelectedProject: (name: string | null) => void;
  refreshAuth: () => Promise<void>;
}

const DataSourceContext = createContext<DataSourceState>({
  mode: 'local',
  authenticated: false,
  teamName: null,
  teamId: null,
  selectedProject: null,
  setSelectedProject: () => {},
  refreshAuth: async () => {},
});

export function useDataSource() {
  return useContext(DataSourceContext);
}

interface DataSourceProviderProps {
  children: ReactNode;
  onAuthRequired: () => void;
}

export function DataSourceProvider({ children, onAuthRequired }: DataSourceProviderProps) {
  const authRequired = isAuthRequired();
  const mode: DataSourceMode = authRequired ? 'server' : 'local';

  const [authenticated, setAuthenticated] = useState(authRequired ? isAuthenticated() : true);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    if (!authRequired) {
      setAuthenticated(true);
      return;
    }

    if (!isAuthenticated()) {
      setAuthenticated(false);
      setTeamName(null);
      setTeamId(null);
      onAuthRequired();
      return;
    }

    try {
      const res = await serverApi.getTeam();
      if (res.success && res.team) {
        setAuthenticated(true);
        setTeamName(res.team.name);
        setTeamId(res.team.id);
      } else {
        setAuthenticated(false);
        onAuthRequired();
      }
    } catch {
      setAuthenticated(false);
      onAuthRequired();
    }
  }, [authRequired, onAuthRequired]);

  useEffect(() => {
    if (authRequired) {
      refreshAuth();
    }

    const handler = () => {
      setAuthenticated(false);
      onAuthRequired();
    };
    window.addEventListener('argusai:auth-required', handler);
    return () => window.removeEventListener('argusai:auth-required', handler);
  }, [authRequired, refreshAuth, onAuthRequired]);

  return (
    <DataSourceContext.Provider
      value={{
        mode,
        authenticated,
        teamName,
        teamId,
        selectedProject,
        setSelectedProject,
        refreshAuth,
      }}
    >
      {children}
    </DataSourceContext.Provider>
  );
}
