set -euo pipefail

BASE="${BASE_URL:-http://127.0.0.1:8000}"
OFFER_ID="${1:-}"                 # uuid или slug (если пусто — возьмём последний из БД)
TG="${TG_TEST_ID:-777000}"
AD_UID="${AD_UID_TEST:-test-uid}" # <-- было UID, теперь AD_UID
EXT_CLICK="${CLICK_TEST:-rs-123}"

red() { printf "\033[31m%s\033[0m\n" "$*"; }
grn() { printf "\033[32m%s\033[0m\n" "$*"; }
ylw() { printf "\033[33m%s\033[0m\n" "$*"; }

need_psql() {
  command -v psql >/dev/null 2>&1 || { red "psql not found"; exit 2; }
}

get_offer_id() {
  if [[ -n "${OFFER_ID}" ]]; then echo "${OFFER_ID}"; return; fi
  need_psql
  local id
  id="$(psql "$DATABASE_URL" -Atc "SELECT id FROM offers ORDER BY created_at DESC LIMIT 1;")"
  [[ -n "$id" ]] || { red "No offers in DB. Create one via /ads"; exit 3; }
  echo "$id"
}

do_click() {
  local offer="$1"
  ylw "[1/5] CLICK offer=$offer uid=$AD_UID click_id=$EXT_CLICK"
  local hdr loc token
  hdr="$(curl -sS -D - "$BASE/click/$offer?uid=$AD_UID&click_id=$EXT_CLICK" -o /dev/null)"
  echo "$hdr" | grep -i '^Location:' >/dev/null || { red "No Location header"; echo "$hdr"; exit 4; }
  loc="$(echo "$hdr" | awk '/^Location:/ {print $2}' | tr -d '\r\n')"
  token="$(echo "$loc" | sed -n 's@.*start=\(.*\)$@\1@p')"
  [[ -n "$token" ]] || { red "No start token parsed from $loc"; exit 5; }
  grn "→ token=$token"
  echo "$token"
}

do_start() {
  local token="$1"
  ylw "[2/5] SIM-START tg_id=$TG"
  curl -sS "$BASE/debug/sim-start?token=$token&tg_id=$TG" | jq .
}

check_attr() {
  ylw "[3/5] CHECK ATTRIBUTION"
  need_psql
  psql "$DATABASE_URL" -c "SELECT user_id, offer_id, uid, tg_id, click_id, state, last_seen FROM attribution WHERE user_id=$TG ORDER BY created_at DESC LIMIT 3;"
}

do_event() {
  local offer="$1"; local type="${2:-join_group}"
  ylw "[4/5] EVENT type=$type"
  curl -sS -X POST "$BASE/debug/event" \
    -H 'content-type: application/json' \
    -d "{\"offer_id\":\"$offer\",\"tg_id\":$TG,\"type\":\"$type\",\"payload\":{}}" | jq .
}

check_events_postbacks() {
  ylw "[5/5] CHECK EVENTS & POSTBACKS"
  need_psql
  psql "$DATABASE_URL" -c "SELECT event_type, tg_id, created_at FROM events WHERE tg_id=$TG ORDER BY created_at DESC LIMIT 5;"
  psql "$DATABASE_URL" -c "SELECT status_code, attempt, left(url,60) AS url FROM postbacks ORDER BY created_at DESC LIMIT 5;"
}

main() {
  local offer token
  offer="$(get_offer_id)"
  token="$(do_click "$offer")"
  do_start "$token"
  check_attr
  do_event "$offer" "join_group"
  check_events_postbacks
  grn "✓ DONE"
}
main "$@"
