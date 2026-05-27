import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProjectList } from '../components/ProjectList';

vi.mock('../api/client', () => ({
  serverApi: {
    getProjects: vi.fn(),
  },
}));

import { serverApi } from '../api/client';

describe('ProjectList', () => {
  const onSelectProject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    (serverApi.getProjects as any).mockReturnValue(new Promise(() => {}));
    render(<ProjectList onSelectProject={onSelectProject} />);
    expect(screen.getByText('项目列表')).toBeTruthy();
  });

  it('renders project cards', async () => {
    (serverApi.getProjects as any).mockResolvedValue({
      success: true,
      projects: [
        {
          id: 'p1',
          name: 'payment-service',
          description: 'Payment API',
          totalRuns: 50,
          lastSyncAt: new Date().toISOString(),
          lastRunStatus: 'passed',
          lastPassRate: 95.0,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'p2',
          name: 'user-service',
          description: null,
          totalRuns: 10,
          lastSyncAt: null,
          lastRunStatus: 'failed',
          lastPassRate: 80.0,
          createdAt: new Date().toISOString(),
        },
      ],
      pagination: { total: 2, limit: 50, offset: 0, hasMore: false },
    });

    render(<ProjectList onSelectProject={onSelectProject} />);

    await waitFor(() => {
      expect(screen.getByText('payment-service')).toBeTruthy();
      expect(screen.getByText('user-service')).toBeTruthy();
    });
  });

  it('shows empty state when no projects', async () => {
    (serverApi.getProjects as any).mockResolvedValue({
      success: true,
      projects: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
    });

    render(<ProjectList onSelectProject={onSelectProject} />);

    await waitFor(() => {
      expect(screen.getByText('暂无项目')).toBeTruthy();
    });
  });

  it('calls onSelectProject when clicking a project', async () => {
    (serverApi.getProjects as any).mockResolvedValue({
      success: true,
      projects: [
        {
          id: 'p1',
          name: 'my-project',
          description: null,
          totalRuns: 10,
          lastSyncAt: null,
          lastRunStatus: null,
          lastPassRate: null,
          createdAt: new Date().toISOString(),
        },
      ],
      pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
    });

    render(<ProjectList onSelectProject={onSelectProject} />);

    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('my-project'));
    expect(onSelectProject).toHaveBeenCalledWith('my-project');
  });
});
