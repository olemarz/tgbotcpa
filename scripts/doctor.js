#!/usr/bin/env node
import 'dotenv/config';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';

const isSoftMode =
  process.argv.includes('--soft') || process.env.DOCTOR_MODE === 'soft' || process.env.NODE_ENV === 'ci';

const results = [];
let hasFailure = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

function log(status, message) {
  const prefix = status === 'OK' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`${prefix} [${status}] ${message}`);
  results.push({ status, message });
  if (status === 'FAIL') {
    hasFailure = true;
  }
}

function fail(message, { soft = false } = {}) {
  if (soft && isSoftMode) {
    log('WARN', `${message} (soft mode)`);
  } else {
    log('FAIL', message);
  }
}

function ok(message) {
  log('OK', message);
}

function warn(message) {
  log('WARN', message);
}

function getEnv(name) {
  const value = process.env[name];
  if (typeof value === 'string') {
    return value.trim();
  }
  return undefined;
}

const requiredEnvVars = ['BOT_TOKEN', 'BOT_USERNAME', 'BASE_URL', 'WEBHOOK_PATH', 'DATABASE_URL', 'DEBUG_TOKEN'];

for (const name of requiredEnvVars) {
  const value = getEnv(name);
  if (value) {
    ok(`${name} is set`);
  } else {
    fail(`${name} is missing`, { soft: true });
  }
}

const baseUrl = getEnv('BASE_URL');
if (baseUrl) {
  try {
    const url = new URL(baseUrl);
    const isSecure = url.protocol === 'https:';
    const isLocalhost = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (!isSecure && !isLocalhost) {
      fail(`BASE_URL must use https, got ${baseUrl}`);
    } else {
      ok(`BASE_URL is valid (${url.origin})`);
    }
  } catch (error) {
    fail(`BASE_URL is not a valid URL (${error.message})`);
  }
} else {
  warn('BASE_URL validation skipped (value missing)');
}

const webhookPath = getEnv('WEBHOOK_PATH');
if (webhookPath) {
  if (!webhookPath.startsWith('/')) {
    fail(`WEBHOOK_PATH must start with '/', got ${webhookPath}`);
  } else {
    ok('WEBHOOK_PATH format looks good');
  }
} else {
  warn('WEBHOOK_PATH validation skipped (value missing)');
}

const nodeVersionMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (Number.isNaN(nodeVersionMajor) || nodeVersionMajor < 20) {
  fail(`Node.js version must be >= 20, current: ${process.versions.node}`);
} else {
  ok(`Node.js version ${process.versions.node}`);
}

if (resolve(process.cwd()) === repoRoot) {
  ok('Running from repository root');
} else {
  fail(`Process cwd mismatch. Expected ${repoRoot}, got ${process.cwd()}`);
}

async function checkDatabase() {
  const dbUrl = getEnv('DATABASE_URL');
  if (!dbUrl) {
    fail('DATABASE_URL missing for DB connectivity check', { soft: true });
    return;
  }
  if (dbUrl.startsWith('pgmem://')) {
    warn('Skipping DB connectivity check for in-memory pgmem URL');
    return;
  }

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    await client.query('SELECT 1');
    ok('Database connection successful');
  } catch (error) {
    fail(`Database connection failed: ${error.message}`);
  } finally {
    try {
      await client.end();
    } catch (endError) {
      warn(`Failed to close DB connection cleanly: ${endError.message}`);
    }
  }
}

async function checkTelegram() {
  const botToken = getEnv('BOT_TOKEN');
  const base = botToken ? `https://api.telegram.org/bot${botToken}` : null;
  if (!botToken || !base) {
    fail('BOT_TOKEN missing for Telegram checks', { soft: true });
    return;
  }

  try {
    const meResponse = await fetch(`${base}/getMe`);
    if (!meResponse.ok) {
      fail(`getMe failed with status ${meResponse.status}`, { soft: true });
      return;
    }
    const meData = await meResponse.json();
    if (!meData.ok) {
      fail(`getMe returned ok=false: ${JSON.stringify(meData)}`, { soft: true });
      return;
    }
    ok('Telegram getMe responded successfully');
  } catch (error) {
    fail(`getMe request failed: ${error.message}`, { soft: true });
    return;
  }

  const baseUrlValue = getEnv('BASE_URL');
  const webhookPathValue = getEnv('WEBHOOK_PATH');
  let expectedWebhookUrl;
  if (baseUrlValue && webhookPathValue) {
    try {
      expectedWebhookUrl = new URL(webhookPathValue, baseUrlValue).toString();
    } catch (error) {
      fail(`Failed to construct webhook URL: ${error.message}`);
    }
  }

  try {
    const infoResponse = await fetch(`${base}/getWebhookInfo`);
    if (!infoResponse.ok) {
      fail(`getWebhookInfo failed with status ${infoResponse.status}`, { soft: true });
      return;
    }
    const infoData = await infoResponse.json();
    if (!infoData.ok) {
      fail(`getWebhookInfo returned ok=false: ${JSON.stringify(infoData)}`, { soft: true });
      return;
    }

    const { url, allowed_updates: allowedUpdates = [] } = infoData.result || {};
    if (expectedWebhookUrl && url !== expectedWebhookUrl) {
      fail(`Webhook URL mismatch. Expected ${expectedWebhookUrl}, got ${url}`, { soft: true });
    } else if (expectedWebhookUrl) {
      ok('Webhook URL matches configuration');
    } else {
      warn('Webhook URL check skipped (missing BASE_URL or WEBHOOK_PATH)');
    }

    const updatesArray = Array.isArray(allowedUpdates) ? allowedUpdates : [];
    const requiredUpdates = ['chat_member', 'my_chat_member'];
    const missing = requiredUpdates.filter((value) => !updatesArray.includes(value));
    if (missing.length > 0) {
      fail(`Webhook allowed_updates missing: ${missing.join(', ')}`, { soft: true });
    } else {
      ok('Webhook allowed_updates include chat_member and my_chat_member');
    }
  } catch (error) {
    fail(`getWebhookInfo request failed: ${error.message}`, { soft: true });
  }
}

const tasks = [checkDatabase(), checkTelegram()];

Promise.all(tasks)
  .catch((error) => {
    fail(`Unexpected doctor error: ${error.message}`);
  })
  .finally(() => {
    if (!hasFailure) {
      console.log('\nDoctor completed without failures');
      process.exit(0);
    } else {
      console.log('\nDoctor detected issues');
      process.exit(1);
    }
  });
