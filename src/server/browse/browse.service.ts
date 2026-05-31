/**
 * Browser automation service (Puppeteer-based)
 *
 * Supports CLI-driven browser control: reading page text, capturing screenshots, etc.
 * The browser instance is lazy-initialized on first use and cleaned up on module destroy.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser, Page } from 'puppeteer';

@Injectable()
export class BrowseService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowseService.name);
  private browser: Browser | null = null;

  /** Puppeteer browser instance (lazy-init) */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const puppeteer = await import('puppeteer');
      this.browser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      this.logger.log('Puppeteer browser started');
    }
    return this.browser;
  }

  /** Open a page and wait for it to load */
  private async openPage(url: string): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    return page;
  }

  /** Extract page text (supports JS-rendered SPAs) */
  async readPage(url: string): Promise<{ title: string; text: string; truncated: boolean }> {
    const page = await this.openPage(url);
    try {
      const title = await page.title();
      const text = await page.evaluate(() => {
        // Remove unnecessary elements
        const removeTags = ['script', 'style', 'nav', 'footer', 'header', 'noscript'];
        removeTags.forEach((tag) => {
          document.querySelectorAll(tag).forEach((el) => el.remove());
        });
        return document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
      });

      const MAX_CHARS = 50000;
      return {
        title,
        text: text.slice(0, MAX_CHARS),
        truncated: text.length > MAX_CHARS,
      };
    } finally {
      await page.close();
    }
  }

  /** Capture a page screenshot */
  async screenshot(url: string, outputPath?: string): Promise<{ base64?: string; path?: string }> {
    const page = await this.openPage(url);
    try {
      if (outputPath) {
        await page.screenshot({ path: outputPath, fullPage: false });
        return { path: outputPath };
      }
      const buffer = await page.screenshot({ fullPage: false, encoding: 'base64' }) as string;
      return { base64: buffer };
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.log('Puppeteer browser closed');
    }
  }
}
