# Contributing

## Writing prompts for Codex
When requesting changes from Codex, please follow this prompt outline:

1. **Context** – briefly describe the user impact or business goal.
2. **Current state** – mention the relevant files, modules, or endpoints.
3. **Desired outcome** – clearly list what should change, using numbered steps when possible.
4. **Constraints** – highlight deadlines, rollout requirements, or forbidden approaches.
5. **Verification** – describe how reviewers can validate the change (tests, manual steps).

Keep the tone concise and actionable. If the task spans multiple domains, split it into smaller prompts so Codex can iterate safely.

## Running the project locally
1. Install dependencies with `npm ci`.
2. Set up environment variables (see `.env.example` or your team secrets). Ensure `DATABASE_URL` points to a reachable Postgres instance.
3. Apply migrations via `npm run migrate`.
4. Run the server locally with `npm start`.
5. Execute the full test suite using `npm test` and verify the environment with `npm run doctor`.

## Deploying
Production deployments are performed directly on the server. SSH into the host and run:

```bash
bash scripts/deploy.sh
```

The script fetches the latest `main`, installs production dependencies, runs migrations, reloads PM2, verifies the doctor checks, and pings the health endpoint.
