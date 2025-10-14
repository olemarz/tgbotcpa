JS := $(shell git ls-files '*.js')

.PHONY: check health webhook-test
check:
	@for f in $(JS); do node --check $$f >/dev/null || exit 1; done && echo "Syntax OK"

health:
	@scripts/health.sh

webhook-test:
	@scripts/test-webhook.sh
