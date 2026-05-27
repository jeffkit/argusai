import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginScreen } from '../components/LoginScreen';

vi.mock('../api/client', () => ({
  setApiKey: vi.fn(),
  addStoredTeam: vi.fn(),
  serverApi: {
    getTeam: vi.fn(),
  },
}));

import { serverApi, setApiKey, addStoredTeam } from '../api/client';

describe('LoginScreen', () => {
  const onLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form', () => {
    render(<LoginScreen onLogin={onLogin} />);
    expect(screen.getByText('ArgusAI Server')).toBeTruthy();
    expect(screen.getByLabelText('API Key')).toBeTruthy();
    expect(screen.getByText('连接')).toBeTruthy();
  });

  it('calls onLogin on successful key validation', async () => {
    (serverApi.getTeam as any).mockResolvedValue({
      success: true,
      team: { id: 't1', name: 'test-team', apiKeyPrefix: 'a1b2c3d4', projectCount: 1, totalRuns: 10, createdAt: '' },
    });

    render(<LoginScreen onLogin={onLogin} />);
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'valid-key-64chars' } });
    fireEvent.click(screen.getByText('连接'));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalled();
      expect(setApiKey).toHaveBeenCalledWith('valid-key-64chars');
      expect(addStoredTeam).toHaveBeenCalled();
    });
  });

  it('shows error on failed validation', async () => {
    (serverApi.getTeam as any).mockRejectedValue(new Error('401'));

    render(<LoginScreen onLogin={onLogin} />);
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'invalid-key' } });
    fireEvent.click(screen.getByText('连接'));

    await waitFor(() => {
      expect(screen.getByText(/连接失败/)).toBeTruthy();
      expect(onLogin).not.toHaveBeenCalled();
    });
  });

  it('disables button when input is empty', () => {
    render(<LoginScreen onLogin={onLogin} />);
    const button = screen.getByText('连接');
    expect(button).toBeDisabled();
  });
});
