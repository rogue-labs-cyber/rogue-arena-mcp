#!/bin/sh
# Test harness for check-updates.sh
# Runs each test in an isolated $HOME with a stubbed curl on $PATH.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="${SCRIPT_DIR}/../hooks/check-updates.sh"
FIXTURES="${SCRIPT_DIR}/fixtures"

PASS=0
FAIL=0
FAILED_TESTS=""

assert_empty_stdout() {
  test_name="$1"
  output="$2"
  if [ -z "$output" ]; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS="${FAILED_TESTS}\n  - $test_name: expected empty stdout, got: $output"
    echo "  FAIL: $test_name (expected empty, got: $output)"
  fi
}

assert_contains() {
  test_name="$1"
  output="$2"
  needle="$3"
  if echo "$output" | grep -q "$needle"; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS="${FAILED_TESTS}\n  - $test_name: expected output to contain '$needle', got: $output"
    echo "  FAIL: $test_name (missing '$needle')"
  fi
}

setup_test() {
  fixture="$1"
  TEST_HOME=$(mktemp -d)
  TEST_BIN=$(mktemp -d)
  if [ -d "${FIXTURES}/${fixture}/home" ]; then
    cp -R "${FIXTURES}/${fixture}/home/." "$TEST_HOME/"
  fi
  if [ -f "${FIXTURES}/${fixture}/fake-curl" ]; then
    cp "${FIXTURES}/${fixture}/fake-curl" "$TEST_BIN/curl"
    chmod +x "$TEST_BIN/curl"
  fi
  ORIG_HOME="$HOME"
  ORIG_PATH="$PATH"
  export HOME="$TEST_HOME"
  export PATH="$TEST_BIN:$PATH"
}

teardown_test() {
  export HOME="$ORIG_HOME"
  export PATH="$ORIG_PATH"
  rm -rf "$TEST_HOME" "$TEST_BIN"
  unset ROGUE_DISABLE_UPDATE_CHECK
}

run_hook() {
  sh "$HOOK" 2>&1
}

# -- Tests -----------------------------------------------------------

test_all_up_to_date() {
  echo "Test: all up to date -> empty stdout"
  setup_test "all-up-to-date"
  out=$(run_hook)
  assert_empty_stdout "all_up_to_date" "$out"
  teardown_test
}

test_mcp_behind() {
  echo "Test: MCP server behind -> shows MCP diff"
  setup_test "mcp-behind"
  out=$(run_hook)
  assert_contains "mcp_behind_shows_header" "$out" "Rogue Arena update available"
  assert_contains "mcp_behind_shows_diff" "$out" "MCP server:"
  teardown_test
}

test_plugin_behind() {
  echo "Test: plugin behind -> shows plugin diff"
  setup_test "plugin-behind"
  out=$(run_hook)
  assert_contains "plugin_behind_shows_diff" "$out" "rogue-build-scenario"
  teardown_test
}

test_cache_fresh_skips_network() {
  echo "Test: fresh cache -> skips network"
  setup_test "cache-fresh"
  out=$(run_hook)
  assert_empty_stdout "cache_fresh_no_network" "$out"
  teardown_test
}

test_network_failure_silent() {
  echo "Test: network failure -> silent"
  setup_test "network-fail"
  out=$(run_hook)
  assert_empty_stdout "network_fail_silent" "$out"
  teardown_test
}

test_missing_local_file_skips() {
  echo "Test: missing local plugin.json -> skip that component, not error"
  setup_test "missing-local"
  out=$(run_hook)
  assert_contains "missing_local_still_runs" "$out" "MCP server:"
  teardown_test
}

test_disable_env_var() {
  echo "Test: ROGUE_DISABLE_UPDATE_CHECK=1 -> silent regardless"
  setup_test "mcp-behind"
  export ROGUE_DISABLE_UPDATE_CHECK=1
  out=$(run_hook)
  assert_empty_stdout "disable_env_var" "$out"
  teardown_test
}

# -- Run all ---------------------------------------------------------
test_all_up_to_date
test_mcp_behind
test_plugin_behind
test_cache_fresh_skips_network
test_network_failure_silent
test_missing_local_file_skips
test_disable_env_var

echo ""
echo "==================================================="
echo "  Results: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  printf "Failures:%b\n" "$FAILED_TESTS"
  exit 1
fi
