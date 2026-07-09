#!/usr/bin/env bash
set -euo pipefail
umask 077

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PROMPT="Return exactly: OK. Do not inspect files. Do not run commands."
TIMEOUT_SECS="${TIMEOUT_SECS:-30}"
WORKDIR="${WORKDIR:-}"
LOG_ROOT_DEFAULT="/tmp/codex-profile-checks"
LOG_ROOT="$LOG_ROOT_DEFAULT"
TARGET_PROFILE=""
QUIET=0

usage() {
  cat <<'EOF'
Usage: check-profiles.sh [profile] [options]

If [profile] is given (e.g. "gpt55"), checks only that profile.
Otherwise checks every Codex profile defined as ~/.codex/*.config.toml by running:
  codex -p <profile> exec "Return exactly: OK. Do not inspect files. Do not run commands."

Options:
  -d, --codex-home DIR   Override Codex home directory (default: ~/.codex)
  -C, --workdir DIR      Run checks from this directory
  -t, --timeout SECS     Per-profile timeout in seconds (default: 30)
  -m, --message TEXT     Prompt to send to codex (default: exact OK reply)
      --log-root DIR     Override log root directory (default: /tmp/codex-profile-checks)
  -q, --quiet            Print only the summary table
  -h, --help             Show this help

Notes:
- The script uses a tiny temporary Git repo by default so profile availability
  is measured without unrelated project context.
- If you want to test a real repo instead, pass --workdir DIR.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--codex-home)
      [[ $# -lt 2 ]] && { echo "Option $1 requires an argument" >&2; exit 2; }
      CODEX_HOME="$2"
      shift 2
      ;;
    -C|--workdir)
      [[ $# -lt 2 ]] && { echo "Option $1 requires an argument" >&2; exit 2; }
      WORKDIR="$2"
      shift 2
      ;;
    -t|--timeout)
      [[ $# -lt 2 ]] && { echo "Option $1 requires an argument" >&2; exit 2; }
      TIMEOUT_SECS="$2"
      shift 2
      ;;
    -m|--message)
      [[ $# -lt 2 ]] && { echo "Option $1 requires an argument" >&2; exit 2; }
      PROMPT="$2"
      shift 2
      ;;
    --log-root)
      [[ $# -lt 2 ]] && { echo "Option $1 requires an argument" >&2; exit 2; }
      LOG_ROOT="$2"
      shift 2
      ;;
    -q|--quiet)
      QUIET=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$TARGET_PROFILE" ]]; then
        TARGET_PROFILE="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 2
      fi
      ;;
  esac
done

if ! command -v codex >/dev/null 2>&1; then
  echo "codex not found on PATH" >&2
  exit 127
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for timeout handling" >&2
  exit 127
fi

if [[ ! -d "$CODEX_HOME" ]]; then
  echo "Codex home does not exist: $CODEX_HOME" >&2
  exit 1
fi

shopt -s nullglob
profile_files=("$CODEX_HOME"/*.config.toml)
shopt -u nullglob

if [[ ${#profile_files[@]} -eq 0 ]]; then
  echo "No profile files found under $CODEX_HOME (*.config.toml)" >&2
  exit 1
fi

if [[ -n "$TARGET_PROFILE" ]]; then
  if [[ "$TARGET_PROFILE" =~ [/.] ]]; then
    echo "Invalid profile name: $TARGET_PROFILE (must not contain / or .)" >&2
    exit 2
  fi
  target_file="$CODEX_HOME/${TARGET_PROFILE}.config.toml"
  if [[ ! -f "$target_file" ]]; then
    echo "Profile not found: $TARGET_PROFILE ($target_file)" >&2
    exit 1
  fi
  profile_files=("$target_file")
fi

get_profile_value() {
  local file="$1"
  local key="$2"
  awk -F'"' -v key="$key" '$1 ~ "^" key " = " { print $2; exit }' "$file"
}

get_profile_numeric_value() {
  local file="$1"
  local key="$2"
  awk -F'= ' -v key="$key" '$1 == key " " { print $2; exit }' "$file"
}

TEMP_WORKDIR=""
AUTO_TEMP_WORKDIR=0

make_temp_git_repo() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-profile-check.XXXXXX")"
  if ! git -C "$dir" init -q 2>/dev/null; then
    rm -rf "$dir"
    echo "Failed to create temp git repo" >&2
    return 1
  fi
  printf '# codex profile check
' > "$dir/README.md"
  echo "$dir"
}

pick_workdir() {
  if [[ -n "$WORKDIR" ]]; then
    echo "$WORKDIR"
    return 0
  fi

  TEMP_WORKDIR="$(make_temp_git_repo)"
  AUTO_TEMP_WORKDIR=1
  echo "$TEMP_WORKDIR"
}

cleanup() {
  if [[ -n "${TEMP_WORKDIR:-}" && -d "$TEMP_WORKDIR" ]]; then
    rm -rf "$TEMP_WORKDIR"
  fi
}
trap cleanup EXIT INT TERM HUP

WORKDIR="$(pick_workdir)"

run_id="$(date '+%Y%m%d-%H%M%S')-$$"
out_dir="$LOG_ROOT/$run_id"
mkdir -p "$out_dir"
# Prune old runs (keep last 20)
find "$LOG_ROOT" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +21 | while read -r old_dir; do
  rm -rf "$old_dir"
done 2>/dev/null || true
summary_tsv="$out_dir/summary.tsv"

run_profile() {
  local profile="$1"
  local logfile="$2"
  local metafile="$3"
  local workdir="$4"
  local prompt="$5"
  local timeout_secs="$6"

  PROFILE="$profile" \
  LOGFILE="$logfile" \
  METAFILE="$metafile" \
  WORKDIR="$workdir" \
  PROMPT="$prompt" \
  TIMEOUT_SECS="$timeout_secs" \
  python3 <<'PY'
import os
import subprocess
import time

profile = os.environ['PROFILE']
logfile = os.environ['LOGFILE']
metafile = os.environ['METAFILE']
workdir = os.environ['WORKDIR']
prompt = os.environ['PROMPT']
timeout_secs = float(os.environ['TIMEOUT_SECS'])
cmd = ['codex', '-p', profile, 'exec', '--skip-git-repo-check', prompt]

start = time.time()
status = 'fail'
returncode = 1
output = ''
error_summary = ''

try:
    proc = subprocess.run(
        cmd,
        cwd=workdir,
        capture_output=True,
        text=True,
        timeout=timeout_secs,
    )
    duration = time.time() - start
    returncode = proc.returncode
    output = (proc.stdout or '') + ('\n' if proc.stdout and proc.stderr else '') + (proc.stderr or '')
    status = 'ok' if proc.returncode == 0 else 'fail'
except subprocess.TimeoutExpired as exc:
    duration = time.time() - start
    returncode = 124
    stdout = exc.stdout or ''
    stderr = exc.stderr or ''
    if isinstance(stdout, bytes):
        stdout = stdout.decode('utf-8', 'replace')
    if isinstance(stderr, bytes):
        stderr = stderr.decode('utf-8', 'replace')
    output = stdout + ('\n' if stdout and stderr else '') + stderr
    status = 'timeout'
except Exception as exc:
    duration = time.time() - start
    returncode = 1
    output = f'Unexpected error: {exc}'
    status = 'fail'

with open(logfile, 'w', encoding='utf-8') as fh:
    fh.write(output)

with open(metafile, 'w', encoding='utf-8') as fh:
    fh.write(f'status={status}\n')
    fh.write(f'exit_code={returncode}\n')
    fh.write(f'duration_s={duration:.2f}\n')
PY
}

extract_metadata_warning_model() {
  local file="$1"
  sed -n 's/.*Model metadata for `\([^`][^`]*\)` not found.*/\1/p' "$file" | head -n 1
}

auto_fix_metadata_for_profile() {
  local profile="$1"
  local profile_file="$2"
  local missing_model="$3"
  local catalog_path
  local provider
  local context_window
  local auto_compact
  local reasoning_effort

  catalog_path="$(get_profile_value "$profile_file" model_catalog_json)"
  if [[ -z "$catalog_path" ]]; then
    catalog_path="$CODEX_HOME/models/model-catalogs.json"
  fi

  # Only allow writes within CODEX_HOME/models
  case "$catalog_path" in
    "$CODEX_HOME"/models/*) ;;
    *)
      echo "Refusing to modify catalog outside \$CODEX_HOME/models: $catalog_path" >&2
      return 1
      ;;
  esac

  if [[ ! -f "$catalog_path" ]]; then
    return 1
  fi

  provider="$(get_profile_value "$profile_file" model_provider)"
  context_window="$(get_profile_numeric_value "$profile_file" model_context_window)"
  auto_compact="$(get_profile_numeric_value "$profile_file" model_auto_compact_token_limit)"
  reasoning_effort="$(get_profile_value "$profile_file" model_reasoning_effort)"

  CATALOG_PATH="$catalog_path" \
  PROFILE_NAME="$profile" \
  MODEL_SLUG="$missing_model" \
  MODEL_PROVIDER="${provider:-unknown}" \
  MODEL_CONTEXT_WINDOW="${context_window:-230000}" \
  MODEL_AUTO_COMPACT="${auto_compact:-195500}" \
  MODEL_REASONING_EFFORT="${reasoning_effort:-high}" \
  python3 <<'PY'
import json
import os
import pathlib
import re
import sys

catalog_path = pathlib.Path(os.environ["CATALOG_PATH"])
profile_name = os.environ["PROFILE_NAME"]
model_slug = os.environ["MODEL_SLUG"]
provider = os.environ["MODEL_PROVIDER"]
context_window = int(float(os.environ["MODEL_CONTEXT_WINDOW"]))
auto_compact = int(float(os.environ["MODEL_AUTO_COMPACT"]))
reasoning_effort = os.environ["MODEL_REASONING_EFFORT"] or "high"

data = json.loads(catalog_path.read_text())
models = data.setdefault("models", [])

for model in models:
    if model.get("slug") == model_slug:
        print("exists")
        sys.exit(0)

display_source = model_slug.split("/")[-1]
display_source = display_source.split(":")[0]
display_name = re.sub(r"[-_]+", " ", display_source).title()

description = f"{display_name} served via {provider} (Responses-compatible)."

entry = {
    "slug": model_slug,
    "display_name": display_name,
    "description": description,
    "default_reasoning_level": reasoning_effort,
    "supported_reasoning_levels": [
        {"effort": "low", "description": "Fast responses with lighter reasoning"},
        {"effort": "medium", "description": "Balances speed and reasoning depth"},
        {"effort": "high", "description": "Greater reasoning depth for complex problems"},
        {"effort": "xhigh", "description": "Extra high reasoning depth"},
    ],
    "shell_type": "shell_command",
    "visibility": "list",
    "supported_in_api": True,
    "priority": 0,
    "base_instructions": "",
    "supports_reasoning_summaries": False,
    "default_reasoning_summary": "none",
    "support_verbosity": False,
    "apply_patch_tool_type": "freeform",
    "web_search_tool_type": "text",
    "truncation_policy": {"mode": "tokens", "limit": 10000},
    "supports_parallel_tool_calls": True,
    "supports_image_detail_original": False,
    "context_window": context_window,
    "max_context_window": context_window,
    "effective_context_window_percent": 95,
    "experimental_supported_tools": [],
    "input_modalities": ["text", "image"],
    "supports_search_tool": False,
    "use_responses_lite": False,
}

models.append(entry)
tmp_path = catalog_path.with_suffix(".json.tmp")
backup_path = catalog_path.with_suffix(".json.bak")
tmp_path.write_text(json.dumps(data, indent=2) + "\n")
if catalog_path.exists():
    catalog_path.replace(backup_path)
tmp_path.rename(catalog_path)
print("added")
PY
}

extract_after_colon() {
  local label="$1"
  local file="$2"
  awk -F': ' -v label="$label" '$1 == label { $1=""; sub(/^  /,""); print; exit }' "$file"
}

extract_tokens() {
  local file="$1"
  awk '
    prev == "tokens used" {
      gsub(/,/, "", $0)
      print $0
      exit
    }
    { prev = $0 }
  ' "$file"
}

extract_note() {
  local status="$1"
  local file="$2"
  local note=""

  if [[ "$status" == "ok" ]]; then
    echo "ok"
    return 0
  fi

  note=$(grep -m1 -E 'channel:client_restricted|403 Forbidden|[Uu]nauthorized|invalid[_ -]?api[_ -]?key|API key|Request too large|tokens per min|stream disconnected before completion' "$file" || true)

  if [[ -z "$note" ]]; then
    note=$(grep -m1 -E '^ERROR:' "$file" || true)
  fi

  if [[ -z "$note" ]]; then
    note=$(grep -m1 -E 'failed|error|Error|ERROR' "$file" || true)
  fi

  if [[ -z "$note" ]]; then
    note=$(tail -n 5 "$file" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')
  fi

  note=${note:-"(see log)"}
  printf '%s\n' "$note" | cut -c1-140
}

print_profile_progress() {
  local profile="$1"
  if [[ "$QUIET" -eq 0 ]]; then
    printf 'Trying profile %s...\n' "$profile"
  fi
}

print_profile_result() {
  local profile="$1"
  local status="$2"
  local duration_s="$3"
  local runtime_provider="$4"
  local runtime_model="$5"
  local note="$6"

  if [[ "$QUIET" -eq 0 ]]; then
    case "$status" in
      ok)
        printf 'Done profile %s: OK in %ss' "$profile" "$duration_s"
        if [[ -n "$runtime_provider" ]]; then
          printf ' | provider=%s' "$runtime_provider"
        fi
        if [[ -n "$runtime_model" ]]; then
          printf ' | model=%s' "$runtime_model"
        fi
        printf '\n\n'
        ;;
      timeout)
        printf 'Done profile %s: TIMEOUT in %ss' "$profile" "$duration_s"
        if [[ -n "$note" ]]; then
          printf ' | %s' "$note"
        fi
        printf '\n\n'
        ;;
      *)
        printf 'Done profile %s: FAIL in %ss' "$profile" "$duration_s"
        if [[ -n "$note" ]]; then
          printf ' | %s' "$note"
        fi
        printf '\n\n'
        ;;
    esac
  fi
}

print_metadata_autofix_progress() {
  local profile="$1"
  local model_slug="$2"
  if [[ "$QUIET" -eq 0 ]]; then
    printf 'Metadata warning for profile %s: auto-fixing catalog entry for %s...\n' "$profile" "$model_slug"
  fi
}

printf 'profile\tmodel_declared\tprovider_declared\tstatus\texit_code\tduration_s\ttokens_used\truntime_model\truntime_provider\tsession_id\tnote\tlogfile\n' > "$summary_tsv"

if [[ "$QUIET" -eq 0 ]]; then
  echo "Codex profile check"
  echo "  codex home : $CODEX_HOME"
  echo "  workdir    : $WORKDIR"
  echo "  mode       : codex -p <profile> exec --skip-git-repo-check \"$PROMPT\""
  echo "  timeout    : ${TIMEOUT_SECS}s"
  echo "  logs       : $out_dir"
  echo
fi

ok_count=0
fail_count=0
timeout_count=0
total_count=0

for profile_file in "${profile_files[@]}"; do
  profile="$(basename "$profile_file" .config.toml)"
  declared_model="$(get_profile_value "$profile_file" model)"
  declared_provider="$(get_profile_value "$profile_file" model_provider)"
  logfile="$out_dir/${profile}.log"
  metafile="$out_dir/${profile}.meta"
  autofix_note=""

  print_profile_progress "$profile"
  run_profile "$profile" "$logfile" "$metafile" "$WORKDIR" "$PROMPT" "$TIMEOUT_SECS"

  metadata_warning_model="$(extract_metadata_warning_model "$logfile")"
  if [[ -n "$metadata_warning_model" ]]; then
    print_metadata_autofix_progress "$profile" "$metadata_warning_model"
    cp "$logfile" "$out_dir/${profile}.pre-autofix.log"
    if auto_fix_metadata_for_profile "$profile" "$profile_file" "$metadata_warning_model" >/dev/null; then
      run_profile "$profile" "$logfile" "$metafile" "$WORKDIR" "$PROMPT" "$TIMEOUT_SECS"
      autofix_note="metadata auto-fixed for $metadata_warning_model"
    else
      autofix_note="metadata auto-fix failed for $metadata_warning_model"
    fi
  fi

  # shellcheck disable=SC1090
  source "$metafile"

  runtime_model="$(extract_after_colon 'model' "$logfile")"
  runtime_provider="$(extract_after_colon 'provider' "$logfile")"
  session_id="$(extract_after_colon 'session id' "$logfile")"
  tokens_used="$(extract_tokens "$logfile")"
  note="$(extract_note "$status" "$logfile")"
  if [[ -n "$autofix_note" ]]; then
    if [[ "$note" == "ok" ]]; then
      note="$autofix_note"
    else
      note="$autofix_note | $note"
    fi
  fi

  case "$status" in
    ok) ok_count=$((ok_count + 1)) ;;
    timeout) timeout_count=$((timeout_count + 1)) ;;
    *) fail_count=$((fail_count + 1)) ;;
  esac
  total_count=$((total_count + 1))

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$profile" \
    "$declared_model" \
    "$declared_provider" \
    "$status" \
    "$exit_code" \
    "$duration_s" \
    "${tokens_used:-}" \
    "${runtime_model:-}" \
    "${runtime_provider:-}" \
    "${session_id:-}" \
    "$note" \
    "$logfile" >> "$summary_tsv"

  print_profile_result "$profile" "$status" "$duration_s" "${runtime_provider:-}" "${runtime_model:-}" "$note"
done

if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$summary_tsv"
else
  cat "$summary_tsv"
fi

echo
printf 'Summary: total=%d ok=%d fail=%d timeout=%d availability=%.1f%%\n' \
  "$total_count" "$ok_count" "$fail_count" "$timeout_count" \
  "$(awk -v ok="$ok_count" -v total="$total_count" 'BEGIN { if (total == 0) print 0; else printf "%.1f", (ok * 100.0 / total) }')"

echo "Summary TSV: $summary_tsv"

if [[ $((fail_count + timeout_count)) -gt 0 ]]; then
  exit 1
fi
