/**
 * Unit tests for BrowserSession playwright initialization (issue #11).
 *
 * playwright is an optional peer dependency — the module and the browser
 * binaries are two separate downloads. These tests pin the contract that a
 * missing piece produces ONE actionable error containing the complete
 * install guide, instead of two sequential mysterious failures.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BrowserSession,
  playwrightTestHooks,
  resetPlaywrightModuleCache,
} from '../../src/browser-executor.js';
import type { PlaywrightModule } from '../../src/browser-executor.js';
import type { BrowserAction, VariableContext } from '../../src/types.js';

function fakeModule(overrides: {
  executablePath?: string;
  launch?: () => Promise<unknown>;
}): PlaywrightModule {
  return {
    chromium: {
      executablePath: () =>
        overrides.executablePath ?? '/fake/.cache/ms-playwright/chromium-1234/chrome-mac/Chromium.app',
      launch: (overrides.launch ??
        (async () => {
          throw new Error('launch should not be called');
        })) as PlaywrightModule['chromium']['launch'],
    },
  };
}

function fakeBrowser() {
  const page = { goto: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
  const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, context, page };
}

const ctx = { runtime: {} } as unknown as VariableContext;
const goto = (url: string) => ({ action: 'goto', url } as unknown as BrowserAction);

describe('BrowserSession playwright initialization (issue #11)', () => {
  afterEach(() => {
    resetPlaywrightModuleCache();
    vi.restoreAllMocks();
  });

  it('should report module missing with the full one-shot install guide', async () => {
    vi.spyOn(playwrightTestHooks, 'loadModule').mockResolvedValue(null);

    const session = new BrowserSession({ baseUrl: 'http://localhost:3000' });

    await expect(session.execute(goto('/'), ctx))
      .rejects
      .toThrow(/module is not installed[\s\S]*npx playwright install chromium/);
  });

  it('should detect missing browser binaries up front instead of failing at launch', async () => {
    const { browser } = fakeBrowser();
    const launch = vi.fn().mockResolvedValue(browser);
    vi.spyOn(playwrightTestHooks, 'loadModule')
      .mockResolvedValue(fakeModule({ executablePath: '/nonexistent/Chromium', launch: launch as never }));

    const session = new BrowserSession({ baseUrl: 'http://localhost:3000' });

    await expect(session.execute(goto('/'), ctx))
      .rejects
      .toThrow(/browser binary is missing[\s\S]*npx playwright install chromium/);
    // Detection must short-circuit before attempting launch
    expect(launch).not.toHaveBeenCalled();
  });

  it('should map launch-time "Executable doesn\'t exist" to the install guide', async () => {
    vi.spyOn(playwrightTestHooks, 'loadModule').mockResolvedValue(fakeModule({
      executablePath: '/exists/but/stale',
      launch: async () => {
        throw new Error("browserType.launch: Executable doesn't exist at /exists/but/stale");
      },
    }));

    const session = new BrowserSession({ baseUrl: 'http://localhost:3000' });

    await expect(session.execute(goto('/'), ctx))
      .rejects
      .toThrow(/Chromium browser binary is missing[\s\S]*npx playwright install chromium/);
  });

  it('should launch normally when module and binaries are present', async () => {
    const { browser, page } = fakeBrowser();
    vi.spyOn(playwrightTestHooks, 'loadModule').mockResolvedValue(fakeModule({
      // existsSync-verified — use a path that actually exists
      executablePath: process.execPath,
      launch: async () => browser as never,
    }));

    const session = new BrowserSession({ baseUrl: 'http://localhost:3000' });
    const { errors } = await session.execute(goto('/health'), ctx);

    expect(errors).toHaveLength(0);
    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://localhost:3000' }),
    );
    expect(page.goto).toHaveBeenCalledWith('/health', expect.objectContaining({ waitUntil: 'domcontentloaded' }));

    await session.close();
  });
});
