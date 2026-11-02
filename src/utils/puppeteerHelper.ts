import puppeteer, { type Browser, type LaunchOptions } from 'puppeteer'
import fs from 'fs'
import { execSync } from 'child_process'

function findSystemChromium(): string | undefined {
  // 1. Check explicit environment variable
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    try {
      if (fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH
      }
    } catch {
      // ignore
    }
  }

  // 2. Common binary locations across Linux distros, Dokploy, Docker & Nixpacks
  const commonPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/lib/chromium/chromium',
    '/run/current-system/sw/bin/chromium', // Nixpacks
    '/nix/var/nix/profiles/default/bin/chromium', // Nix
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]

  for (const p of commonPaths) {
    try {
      if (fs.existsSync(p)) {
        return p
      }
    } catch {
      // ignore
    }
  }

  // 3. Dynamic lookup using shell 'which'
  if (process.platform === 'linux' || process.platform === 'darwin') {
    try {
      const detected = execSync('which chromium || which chromium-browser || which google-chrome-stable || which google-chrome', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim()
      if (detected && fs.existsSync(detected)) {
        return detected
      }
    } catch {
      // ignore
    }
  }

  // 4. Check if puppeteer installed chrome in /root/.cache/puppeteer or ~/.cache/puppeteer
  const cacheDirs = [
    '/root/.cache/puppeteer/chrome',
    `${process.env.HOME || ''}/.cache/puppeteer/chrome`,
  ]
  for (const cacheDir of cacheDirs) {
    try {
      if (fs.existsSync(cacheDir)) {
        const subdirs = fs.readdirSync(cacheDir)
        for (const sub of subdirs) {
          const chromeBin = `${cacheDir}/${sub}/chrome-linux64/chrome`
          if (fs.existsSync(chromeBin)) {
            return chromeBin
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined
}

export function getPuppeteerLaunchOptions(): LaunchOptions {
  const executablePath = findSystemChromium()

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--font-render-hinting=medium',
  ]

  // In Docker / Dokploy containers with limited memory, single-process helps stability
  if (process.env.DOCKER_CONTAINER || process.platform === 'linux') {
    args.push('--single-process')
  }

  return {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args,
  }
}

export async function launchPuppeteerBrowser(): Promise<Browser> {
  const options = getPuppeteerLaunchOptions()
  try {
    return await puppeteer.launch(options)
  } catch (err: any) {
    console.error('Puppeteer launch error with options:', options, err)
    throw new Error(
      `Could not launch Chrome for PDF generation on Dokploy. ${err.message || ''}\n` +
      `Fix: In Dokploy, install chromium in your Dockerfile (apt-get install -y chromium) or set PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium.`
    )
  }
}
