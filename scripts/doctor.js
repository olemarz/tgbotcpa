/* eslint-disable no-console */
import 'dotenv/config';
import assert from 'node:assert';
import pkg from 'pg';
const { Client } = pkg;
import fetch from 'node-fetch';

(async () => {
  try {
    const required = ['BOT_TOKEN','BASE_URL','WEBHOOK_PATH','DATABASE_URL'];
    required.forEach(k => assert(process.env[k], `Missing ${k}`));

    const baseUrl = process.env.BASE_URL.replace(/\/$/, '');
    // 1) DB
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    const r = await client.query('SELECT NOW() AS now');
    console.log('DB OK:', r.rows[0].now?.toISOString());
    await client.end();

    // 2) Health
    const h = await fetch(`${baseUrl}/health`).then(x => x.json());
    console.log('Health OK:', h);

    // 3) Webhook check (getWebhookInfo)
    const info = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getWebhookInfo`).then(r=>r.json());
    console.log('Webhook info:', info);

    console.log('Doctor: PASS');
    process.exit(0);
  } catch (e) {
    console.error('Doctor: FAIL', e?.message || e);
    process.exit(1);
  }
})();
