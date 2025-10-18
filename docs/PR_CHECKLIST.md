# PR Checklist

- [ ] Added or updated tests cover the change (run `npm test`).
- [ ] `npm run doctor` passes locally.
- [ ] Database migrations (if any) are idempotent and documented in `docs/DATA_AND_MIGRATIONS.md`.
- [ ] Environment variable changes are reflected in `DOCS/ENV.md` and `docs/CONFIG_ENV.md`.
- [ ] Webhook or bot-breaking changes include rollout notes in `DOCS/RUNBOOK.md`.
- [ ] Documentation updates are mentioned in `docs/CHANGELOG.md`.
