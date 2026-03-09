/**
 * @module browser-executor
 * Playwright-based browser action executor for YAML browser test steps.
 *
 * Manages a shared browser context across test steps within a suite,
 * executes declarative browser actions, and evaluates page assertions.
 */

import type { BrowserAction, PageExpect, VariableContext } from './types.js';
import { parseTime } from './yaml-engine.js';
import type { Browser, BrowserContext, Page } from 'playwright';

// =====================================================================
// Browser Session Manager
// =====================================================================

/**
 * Manages a Playwright browser instance and page across YAML test steps.
 *
 * Lifecycle:
 * - Lazily initialized on first `execute()` call
 * - Persists across all steps in a suite
 * - Must be explicitly closed via `close()`
 */
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private baseUrl: string;
  private headless: boolean;
  private lastEvaluateResult: unknown = undefined;

  constructor(options: { baseUrl: string; headless?: boolean }) {
    this.baseUrl = options.baseUrl;
    this.headless = options.headless ?? true;
  }

  private async ensureReady(): Promise<Page> {
    if (this.page) return this.page;

    const pw = await importPlaywright();
    this.browser = await pw.chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({
      baseURL: this.baseUrl,
      viewport: { width: 1280, height: 720 },
    });
    this.page = await this.context.newPage();
    return this.page;
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  // =====================================================================
  // Action Execution
  // =====================================================================

  /**
   * Execute a browser action and return any errors.
   */
  async execute(
    action: BrowserAction,
    ctx: VariableContext,
  ): Promise<{ errors: string[]; result?: unknown }> {
    const page = await this.ensureReady();
    const timeout = action.timeout ? parseTime(action.timeout) : 30_000;
    const errors: string[] = [];

    try {
      switch (action.action) {
        case 'goto': {
          const url = action.url || '/';
          try {
            await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
          } catch (gotoErr) {
            const msg = (gotoErr as Error).message;
            if (msg.includes('ERR_ABORTED') || msg.includes('Navigation')) {
              await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
            } else {
              throw gotoErr;
            }
          }
          break;
        }

        case 'click': {
          if (!action.selector) {
            errors.push('click action requires a "selector"');
            break;
          }
          await page.locator(action.selector).click({ timeout });
          break;
        }

        case 'fill': {
          if (!action.selector || action.value === undefined) {
            errors.push('fill action requires "selector" and "value"');
            break;
          }
          await page.locator(action.selector).fill(action.value, { timeout });
          break;
        }

        case 'type': {
          if (!action.selector || action.value === undefined) {
            errors.push('type action requires "selector" and "value"');
            break;
          }
          await page.locator(action.selector).pressSequentially(action.value, { timeout, delay: 50 });
          break;
        }

        case 'press': {
          const key = action.key || 'Enter';
          if (action.selector) {
            await page.locator(action.selector).press(key, { timeout });
          } else {
            await page.keyboard.press(key);
          }
          break;
        }

        case 'select': {
          if (!action.selector) {
            errors.push('select action requires a "selector"');
            break;
          }
          if (typeof action.option === 'string') {
            await page.locator(action.selector).selectOption(action.option, { timeout });
          } else if (action.option) {
            await page.locator(action.selector).selectOption(action.option, { timeout });
          }
          break;
        }

        case 'check': {
          if (!action.selector) { errors.push('check action requires a "selector"'); break; }
          await page.locator(action.selector).check({ timeout });
          break;
        }

        case 'uncheck': {
          if (!action.selector) { errors.push('uncheck action requires a "selector"'); break; }
          await page.locator(action.selector).uncheck({ timeout });
          break;
        }

        case 'hover': {
          if (!action.selector) { errors.push('hover action requires a "selector"'); break; }
          await page.locator(action.selector).hover({ timeout });
          break;
        }

        case 'focus': {
          if (!action.selector) { errors.push('focus action requires a "selector"'); break; }
          await page.locator(action.selector).focus({ timeout });
          break;
        }

        case 'clear': {
          if (!action.selector) { errors.push('clear action requires a "selector"'); break; }
          await page.locator(action.selector).clear({ timeout });
          break;
        }

        case 'waitForSelector': {
          if (!action.selector) { errors.push('waitForSelector action requires a "selector"'); break; }
          await page.locator(action.selector).first().waitFor({ state: 'visible', timeout });
          break;
        }

        case 'waitForURL': {
          const url = action.url || '**';
          await page.waitForURL(url, { timeout });
          break;
        }

        case 'waitForLoadState': {
          await page.waitForLoadState(action.state || 'load', { timeout });
          break;
        }

        case 'screenshot': {
          const screenshotPath = action.path || `screenshot-${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          break;
        }

        case 'evaluate': {
          if (!action.script) { errors.push('evaluate action requires a "script"'); break; }
          this.lastEvaluateResult = await page.evaluate(action.script);
          break;
        }

        case 'setLocalStorage': {
          if (!action.storage) { errors.push('setLocalStorage action requires "storage"'); break; }
          for (const [key, value] of Object.entries(action.storage)) {
            await page.evaluate(
              ([k, v]: [string, string]) => localStorage.setItem(k, v),
              [key, value] as [string, string],
            );
          }
          break;
        }

        case 'scrollTo': {
          if (action.selector) {
            await page.locator(action.selector).scrollIntoViewIfNeeded({ timeout });
          } else if (action.position) {
            await page.evaluate(
              ([x, y]: [number, number]) => { (globalThis as unknown as { scrollTo: (x: number, y: number) => void }).scrollTo(x, y); },
              [action.position.x, action.position.y] as [number, number],
            );
          }
          break;
        }

        default:
          errors.push(`Unknown browser action: "${action.action}"`);
      }
    } catch (err) {
      errors.push(`Browser action "${action.action}" failed: ${(err as Error).message}`);
    }

    return { errors, result: this.lastEvaluateResult };
  }

  // =====================================================================
  // Page Assertions
  // =====================================================================

  /**
   * Evaluate page-level assertions and return errors.
   */
  async assertPage(expect: PageExpect): Promise<string[]> {
    const page = await this.ensureReady();
    const errors: string[] = [];

    // URL assertions
    if (expect.url !== undefined) {
      const currentUrl = page.url();
      if (typeof expect.url === 'string') {
        if (currentUrl !== expect.url) {
          errors.push(`Page URL: expected "${expect.url}", got "${currentUrl}"`);
        }
      } else {
        if (expect.url.contains && !currentUrl.includes(expect.url.contains)) {
          errors.push(`Page URL: expected to contain "${expect.url.contains}", got "${currentUrl}"`);
        }
        if (expect.url.notContains && currentUrl.includes(expect.url.notContains)) {
          errors.push(`Page URL: expected NOT to contain "${expect.url.notContains}", got "${currentUrl}"`);
        }
        if (expect.url.startsWith && !currentUrl.startsWith(expect.url.startsWith)) {
          errors.push(`Page URL: expected to start with "${expect.url.startsWith}", got "${currentUrl}"`);
        }
        if (expect.url.matches) {
          const re = new RegExp(expect.url.matches);
          if (!re.test(currentUrl)) {
            errors.push(`Page URL: expected to match /${expect.url.matches}/, got "${currentUrl}"`);
          }
        }
      }
    }

    // Title assertions
    if (expect.title !== undefined) {
      const title = await page.title();
      if (typeof expect.title === 'string') {
        if (title !== expect.title) {
          errors.push(`Page title: expected "${expect.title}", got "${title}"`);
        }
      } else {
        if (expect.title.contains && !title.includes(expect.title.contains)) {
          errors.push(`Page title: expected to contain "${expect.title.contains}", got "${title}"`);
        }
        if (expect.title.matches) {
          const re = new RegExp(expect.title.matches);
          if (!re.test(title)) {
            errors.push(`Page title: expected to match /${expect.title.matches}/, got "${title}"`);
          }
        }
      }
    }

    // Visible elements
    if (expect.visible) {
      for (const selector of expect.visible) {
        try {
          const isVisible = await page.locator(selector).first().isVisible();
          if (!isVisible) {
            errors.push(`Expected element to be visible: "${selector}"`);
          }
        } catch (err) {
          errors.push(`Visibility check failed for "${selector}": ${(err as Error).message}`);
        }
      }
    }

    // Hidden elements
    if (expect.hidden) {
      for (const selector of expect.hidden) {
        try {
          const isVisible = await page.locator(selector).first().isVisible();
          if (isVisible) {
            errors.push(`Expected element to be hidden: "${selector}"`);
          }
        } catch {
          // Element not found = hidden, which is correct
        }
      }
    }

    // Text content assertions
    if (expect.text) {
      for (const [selector, expected] of Object.entries(expect.text)) {
        try {
          const text = await page.locator(selector).first().textContent({ timeout: 5_000 });
          if (typeof expected === 'string') {
            if (text !== expected) {
              errors.push(`Text of "${selector}": expected "${expected}", got "${text}"`);
            }
          } else {
            if (expected.contains && (!text || !text.includes(expected.contains))) {
              errors.push(`Text of "${selector}": expected to contain "${expected.contains}", got "${text}"`);
            }
            if (expected.matches) {
              const re = new RegExp(expected.matches);
              if (!text || !re.test(text)) {
                errors.push(`Text of "${selector}": expected to match /${expected.matches}/, got "${text}"`);
              }
            }
          }
        } catch (err) {
          errors.push(`Text assertion failed for "${selector}": ${(err as Error).message}`);
        }
      }
    }

    // Input value assertions
    if (expect.inputValue) {
      for (const [selector, expected] of Object.entries(expect.inputValue)) {
        try {
          const value = await page.locator(selector).first().inputValue({ timeout: 5_000 });
          if (value !== expected) {
            errors.push(`Input value of "${selector}": expected "${expected}", got "${value}"`);
          }
        } catch (err) {
          errors.push(`Input value assertion failed for "${selector}": ${(err as Error).message}`);
        }
      }
    }

    // Element count assertions
    if (expect.count) {
      for (const [selector, expected] of Object.entries(expect.count)) {
        try {
          const count = await page.locator(selector).count();
          if (typeof expected === 'number') {
            if (count !== expected) {
              errors.push(`Count of "${selector}": expected ${expected}, got ${count}`);
            }
          } else {
            if (expected.gt !== undefined && !(count > expected.gt)) {
              errors.push(`Count of "${selector}": expected > ${expected.gt}, got ${count}`);
            }
            if (expected.gte !== undefined && !(count >= expected.gte)) {
              errors.push(`Count of "${selector}": expected >= ${expected.gte}, got ${count}`);
            }
            if (expected.lt !== undefined && !(count < expected.lt)) {
              errors.push(`Count of "${selector}": expected < ${expected.lt}, got ${count}`);
            }
            if (expected.lte !== undefined && !(count <= expected.lte)) {
              errors.push(`Count of "${selector}": expected <= ${expected.lte}, got ${count}`);
            }
          }
        } catch (err) {
          errors.push(`Count assertion failed for "${selector}": ${(err as Error).message}`);
        }
      }
    }

    // Evaluate result assertions
    if (expect.result !== undefined) {
      const actual = this.lastEvaluateResult;
      if (typeof expect.result === 'object' && expect.result !== null) {
        const strActual = JSON.stringify(actual);
        const strExpected = JSON.stringify(expect.result);
        if (strActual !== strExpected) {
          errors.push(`Evaluate result: expected ${strExpected}, got ${strActual}`);
        }
      } else {
        if (actual !== expect.result) {
          errors.push(`Evaluate result: expected ${JSON.stringify(expect.result)}, got ${JSON.stringify(actual)}`);
        }
      }
    }

    return errors;
  }

  /**
   * Save page state into variable context.
   *
   * Supported save paths:
   * - "page.url" → current URL
   * - "page.title" → current page title
   * - "result" → last evaluate result
   * - "text:<selector>" → text content of element
   * - "value:<selector>" → input value of element
   * - "count:<selector>" → element count
   */
  async saveVariables(
    saveMap: Record<string, string>,
    ctx: VariableContext,
  ): Promise<void> {
    const page = await this.ensureReady();

    for (const [varName, savePath] of Object.entries(saveMap)) {
      let value: string | undefined;

      if (savePath === 'page.url') {
        value = page.url();
      } else if (savePath === 'page.title') {
        value = await page.title();
      } else if (savePath === 'result') {
        value = this.lastEvaluateResult !== undefined
          ? String(this.lastEvaluateResult)
          : undefined;
      } else if (savePath.startsWith('text:')) {
        const selector = savePath.slice(5);
        value = await page.locator(selector).first().textContent({ timeout: 5_000 }) ?? undefined;
      } else if (savePath.startsWith('value:')) {
        const selector = savePath.slice(6);
        value = await page.locator(selector).first().inputValue({ timeout: 5_000 });
      } else if (savePath.startsWith('count:')) {
        const selector = savePath.slice(6);
        value = String(await page.locator(selector).count());
      }

      if (value !== undefined) {
        ctx.runtime[varName] = value;
      }
    }
  }
}

// =====================================================================
// Dynamic Playwright Import
// =====================================================================

interface PlaywrightModule {
  chromium: {
    launch(options?: { headless?: boolean }): Promise<Browser>;
  };
}

let playwrightModule: PlaywrightModule | null = null;

async function importPlaywright(): Promise<PlaywrightModule> {
  if (playwrightModule) return playwrightModule;

  try {
    playwrightModule = await import('playwright') as PlaywrightModule;
    return playwrightModule;
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      playwrightModule = await (Function('return import("playwright-core")')() as Promise<PlaywrightModule>);
      return playwrightModule!;
    } catch {
      throw new Error(
        'Playwright is required for browser test steps. Install it with: npm install playwright',
      );
    }
  }
}
