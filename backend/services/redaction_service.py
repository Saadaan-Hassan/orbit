"""
Inline sensitive-content redaction for browser-captured text.

Ports the same patterns used by the Rust clipboard redactor in
clipboard.rs, but applies inline substitution rather than whole-value
replacement. Page text may contain useful article context around a secret
(e.g. a tutorial showing an example token) — we redact only the matched
substring and preserve the rest.

The Rust clipboard redactor returns on the first matched category because
it replaces the entire value anyway. This function applies every pattern
so that a page containing multiple secret types has all of them redacted.
"""

import re

# ---------------------------------------------------------------------------
# PEM private key
# ---------------------------------------------------------------------------

# Matches the entire block from header to footer, including multi-line bodies.
# Must be applied first — PEM blocks are high-severity and their bodies contain
# long base64 strings that some lower-priority patterns (e.g. JWT) could also
# partially match before this pattern runs.
_PEM_PRIVATE_KEY_PATTERN = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    re.DOTALL,
)

# ---------------------------------------------------------------------------
# API key prefixes
# ---------------------------------------------------------------------------

# Full list ported from KNOWN_API_KEY_PREFIXES in clipboard.rs.
# Sorted longest-first at pattern-build time so longer prefixes take priority
# when they share a leading substring (e.g. "github_pat_" before "ghp_",
# "sk_live_" before "sk-").
_API_KEY_PREFIXES: tuple[str, ...] = (
    "github_pat_", "dop_v1_",  "sb_secret_", "lin_api_",  "sntrys_",
    "sk_live_",    "pk_live_", "sk_test_",   "pk_test_",  "rk_live_", "rk_test_",
    "whsec_",      "glpat-",   "glptt-",     "gldt-",
    "xoxb-",       "xoxp-",    "xoxa-",      "xoxr-",     "xapp-",
    "shpat_",      "shpss_",   "shpca_",
    "AIza",        "AKIA",
    "ghp_",        "gho_",     "ghs_",       "ghr_",
    "npm_",        "hf_",      "phc_",
    "gsk_",        "sk-",         "pa-",
    "re_",         "SG.",      "cf_",
)


def _build_api_key_pattern(prefixes: tuple[str, ...]) -> re.Pattern[str]:
    # Sort longest-first inside the alternation so the regex engine tries
    # the most-specific prefix before any of its shorter substrings.
    sorted_prefixes = sorted(prefixes, key=len, reverse=True)
    alternation = "|".join(re.escape(p) for p in sorted_prefixes)
    # (?<![A-Za-z0-9_]) — negative lookbehind prevents matching in the middle
    # of a larger identifier (e.g. the "sk-" inside "mysk-key" is not a token).
    # [\w.\-]{8,} — the token body must be at least 8 chars to exclude short
    # common words that share a prefix (e.g. "re_load", "cf_options").
    return re.compile(r"(?<![A-Za-z0-9_])(?:" + alternation + r")[\w.\-]{8,}")


_API_KEY_PATTERN = _build_api_key_pattern(_API_KEY_PREFIXES)

# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

# Require the first segment to start with "eyJ" — the base64url encoding of
# '{"', present in every standard JWT header. This avoids false positives from
# other dot-separated base64 blobs that happen to have three long segments.
_JWT_PATTERN = re.compile(
    r"eyJ[A-Za-z0-9_\-]{7,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"
)

# ---------------------------------------------------------------------------
# Credit card, SSN
# ---------------------------------------------------------------------------

# Same regex as clipboard.rs: four groups of digits, optional space/dash
# separators between groups. Handles "4111 1111 1111 1111" and the unspaced form.
_CREDIT_CARD_PATTERN = re.compile(
    r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,7}\b"
)

# US Social Security Number — canonical hyphenated form only.
_SSN_PATTERN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")

# ---------------------------------------------------------------------------
# Crypto addresses
# ---------------------------------------------------------------------------

# Ethereum: 0x + exactly 40 hex characters.
_ETHEREUM_ADDRESS_PATTERN = re.compile(r"\b0x[a-fA-F0-9]{40}\b")

# Bitcoin addresses — three address types matched by their known structure:
#   P2PKH  starts with "1", base58 chars, total length 26–34
#   P2SH   starts with "3", base58 chars, total length 26–34
#   Bech32 starts with "bc1", lowercase alphanumeric, total length 14–74
#
# The base58 charset [a-km-zA-HJ-NP-Z1-9] excludes the visually ambiguous
# characters 0, O, I, l — using it prevents matching arbitrary digit strings.
# Length bounds mirror the 26–62 check in clipboard.rs.
_BITCOIN_ADDRESS_PATTERN = re.compile(
    r"\b(?:"
    r"1[a-km-zA-HJ-NP-Z1-9]{25,61}"    # P2PKH  (26–62 chars total)
    r"|3[a-km-zA-HJ-NP-Z1-9]{25,61}"   # P2SH   (26–62 chars total)
    r"|bc1[a-z0-9]{23,59}"              # Bech32 (26–62 chars total)
    r")\b"
)

# ---------------------------------------------------------------------------
# Ordered substitution pipeline
# ---------------------------------------------------------------------------

# Applied in descending severity order — same priority as clipboard.rs.
# Running all patterns (rather than stopping on the first match) ensures that
# page text containing multiple secret types has every secret redacted.
_REDACTION_STEPS: list[tuple[re.Pattern[str], str]] = [
    (_PEM_PRIVATE_KEY_PATTERN,  "[REDACTED:private_key]"),
    (_API_KEY_PATTERN,          "[REDACTED:api_key]"),
    (_JWT_PATTERN,              "[REDACTED:jwt_token]"),
    (_CREDIT_CARD_PATTERN,      "[REDACTED:credit_card]"),
    (_SSN_PATTERN,              "[REDACTED:ssn]"),
    (_ETHEREUM_ADDRESS_PATTERN, "[REDACTED:crypto_address]"),
    (_BITCOIN_ADDRESS_PATTERN,  "[REDACTED:crypto_address]"),
]


def redact_sensitive_content(text: str) -> str:
    """
    Returns `text` with any detected secrets replaced inline by [REDACTED:type].

    Each pattern runs as a full-text substitution so all occurrences are
    redacted in a single pass per pattern. The surrounding context (article
    body, search query prefix/suffix, etc.) is preserved — only the matched
    secret substring is replaced.
    """
    for pattern, placeholder in _REDACTION_STEPS:
        text = pattern.sub(placeholder, text)
    return text
