#!/usr/bin/env bash
# Credential-safe diagnostics for captured external-tool failures.
#
# Never print captured provider output from these helpers. Classification reads
# private files with quiet pattern matches, and rendering emits only allowlisted
# fields plus a fixed diagnostic for the selected category.

external_tool_stream_matches() {
  local pattern="$1"
  shift
  local candidate_file

  for candidate_file in "$@"; do
    [[ -f "$candidate_file" ]] || continue
    if LC_ALL=C grep -aEiq -- "$pattern" "$candidate_file" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

classify_external_tool_failure() {
  local stdout_file="$1"
  local stderr_file="$2"

  if external_tool_stream_matches \
    'password authentication failed|authentication failed|authentication required|no password supplied|unauthorized|(^|[^0-9])401([^0-9]|$)|(^|[^[:alnum:]_.-])invalid[[:space:]]+(api[[:space:]]+)?key([^[:alnum:]_]|$)|(^|[^[:alnum:]_.-])invalid[[:space:]]+(bearer[[:space:]]+)?token([^[:alnum:]_]|$)' \
    "$stdout_file" "$stderr_file"; then
    printf '%s\n' authentication_failure
  elif external_tool_stream_matches \
    'SSL error|TLS|certificate (verify failed|verification failed|has expired|is not yet valid|is invalid)|self[- ]signed certificate|channel binding.*(failed|required|not supported)|server does not support SSL' \
    "$stdout_file" "$stderr_file"; then
    printf '%s\n' tls
  elif external_tool_stream_matches \
    'could not translate host name|name or service not known|nodename nor servname|temporary failure in name resolution|getaddrinfo' \
    "$stdout_file" "$stderr_file"; then
    printf '%s\n' dns
  elif external_tool_stream_matches \
    'connection refused|server closed the connection unexpectedly|connection reset by peer|could not connect to server|terminating connection due to administrator command' \
    "$stdout_file" "$stderr_file"; then
    printf '%s\n' connection_refused
  elif external_tool_stream_matches \
    'tim(e|ed)[ -]?out|timeout expired|connection timeout|statement timeout|canceling statement due to statement timeout|operation timed out' \
    "$stdout_file" "$stderr_file"; then
    printf '%s\n' timeout
  elif external_tool_stream_matches \
    'permission denied|insufficient privilege|not permitted|forbidden|(^|[^0-9])403([^0-9]|$)|must be owner' \
    "$stdout_file" "$stderr_file"; then
    printf '%s\n' permission_denied
  elif external_tool_stream_matches \
    '(^|[[:space:]])ERROR:|syntax error|relation .* does not exist|column .* does not exist|invalid input syntax|query failed|bad request|unprocessable' \
    "$stdout_file" "$stderr_file"; then
    printf '%s\n' query_error
  else
    printf '%s\n' unknown
  fi
}

external_tool_failure_is_transient() {
  case "$1" in
    connection_refused | timeout | dns) return 0 ;;
    *) return 1 ;;
  esac
}

external_tool_failure_diagnostic() {
  case "$1" in
    connection_refused) printf '%s\n' remote_connection_refused_or_reset ;;
    timeout) printf '%s\n' remote_operation_timed_out ;;
    authentication_failure) printf '%s\n' remote_authentication_rejected ;;
    tls) printf '%s\n' tls_or_channel_binding_negotiation_failed ;;
    dns) printf '%s\n' remote_host_name_resolution_failed ;;
    permission_denied) printf '%s\n' remote_permission_denied ;;
    query_error) printf '%s\n' remote_query_or_request_rejected ;;
    *) printf '%s\n' provider_output_withheld_unclassified ;;
  esac
}

emit_sanitized_external_tool_failure() {
  local namespace="$1"
  local tool="$2"
  local phase="$3"
  local status="$4"
  local category="$5"
  local retryable=false
  local diagnostic

  # Call-site labels are data too. Keep them on exact allowlists so a caller
  # cannot accidentally reflect a credential-shaped value through metadata.
  case "$namespace" in
    live-verify | neon-recovery) ;;
    *) namespace=external-tool ;;
  esac
  case "$tool" in
    psql | curl) ;;
    *) tool=unknown ;;
  esac
  case "$phase" in
    connection-warmup | query | snapshot | assertion | api-request) ;;
    *) phase=unknown ;;
  esac
  case "$status" in
    '' | *[!0-9]*) status=unavailable ;;
  esac
  case "$category" in
    connection_refused | timeout | authentication_failure | tls | dns | permission_denied | query_error | unknown) ;;
    *) category=unknown ;;
  esac

  if external_tool_failure_is_transient "$category"; then
    retryable=true
  fi
  diagnostic="$(external_tool_failure_diagnostic "$category")"
  printf '%s: external-tool failure tool=%s phase=%s status=%s category=%s retryable=%s diagnostic=%s\n' \
    "$namespace" "$tool" "$phase" "$status" "$category" "$retryable" "$diagnostic"
}
