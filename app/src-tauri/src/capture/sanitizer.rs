//! Shared, fail-safe sanitization for values written by Rust capture monitors.
//!
//! This is intentionally applied before SQLite persistence rather than when
//! data is later displayed or sent to a provider. The Python boundary performs
//! separate defence-in-depth redaction for non-Rust capture sources.

use regex::{Captures, Regex};
use sqlx::SqlitePool;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const MAX_INPUT_CHARS: usize = 32_768;
const MAX_TEXT_OUTPUT_CHARS: usize = 16_384;
const MAX_URL_OUTPUT_CHARS: usize = 4_096;
const MAX_CUSTOM_PATTERNS: usize = 50;
const MAX_CUSTOM_PATTERN_CHARS: usize = 256;
const CUSTOM_PATTERN_CACHE_TTL: Duration = Duration::from_secs(30);
const TRUNCATED_MARKER: &str = "[TRUNCATED]";

const KNOWN_API_KEY_PREFIXES: &[&str] = &[
    "github_pat_",
    "dop_v1_",
    "sb_secret_",
    "lin_api_",
    "sntrys_",
    "sk_live_",
    "pk_live_",
    "sk_test_",
    "rk_live_",
    "rk_test_",
    "whsec_",
    "glpat-",
    "glptt-",
    "gldt-",
    "xoxb-",
    "xoxp-",
    "xoxa-",
    "xoxr-",
    "xapp-",
    "shpat_",
    "shpss_",
    "shpca_",
    "AIza",
    "AKIA",
    "ghp_",
    "gho_",
    "ghs_",
    "ghr_",
    "npm_",
    "hf_",
    "phc_",
    "sk-",
    "pa-",
    "re_",
    "SG.",
    "cf_",
];

/// A local cache of user-selected exact-match phrases. Static redaction never
/// depends on this cache, so a missing table or a database error remains safe.
pub struct RedactionPatternCache {
    patterns: Vec<String>,
    last_refreshed_at: Instant,
}

impl RedactionPatternCache {
    pub fn new() -> Self {
        Self {
            patterns: Vec::new(),
            last_refreshed_at: Instant::now()
                .checked_sub(CUSTOM_PATTERN_CACHE_TTL * 2)
                .unwrap_or_else(Instant::now),
        }
    }

    /// Reloads patterns at most every 30 seconds. Values are exact phrases, not
    /// user-supplied regular expressions, so privacy settings cannot introduce
    /// a catastrophic-pattern matcher into the capture hot path.
    pub async fn refresh_if_stale(&mut self, pool: &SqlitePool) {
        if self.last_refreshed_at.elapsed() < CUSTOM_PATTERN_CACHE_TTL {
            return;
        }

        let query_result = sqlx::query_as::<_, (String,)>(
            "SELECT pattern FROM redaction_patterns ORDER BY length(pattern) DESC, pattern ASC LIMIT 50",
        )
        .fetch_all(pool)
        .await;

        self.patterns = match query_result {
            Ok(rows) => rows
                .into_iter()
                .map(|(pattern,)| pattern)
                .filter(|pattern| is_valid_custom_pattern(pattern))
                .take(MAX_CUSTOM_PATTERNS)
                .collect(),
            // Do not preserve a potentially stale custom phrase after a DB
            // failure: static redaction remains active and no old pattern is
            // mistaken for a current user preference.
            Err(_) => Vec::new(),
        };
        self.last_refreshed_at = Instant::now();
    }

    pub fn sanitize_text(&self, input: &str) -> String {
        sanitize_text_with_patterns(input, &self.patterns)
    }

    pub fn sanitize_url(&self, input: &str) -> String {
        sanitize_url_with_patterns(input, &self.patterns)
    }
}

#[allow(dead_code)] // Used by the retained legacy monitor sources as a safe fallback.
pub fn sanitize_text(input: &str) -> String {
    sanitize_text_with_patterns(input, &[])
}

#[allow(dead_code)] // Used by the retained legacy monitor sources as a safe fallback.
pub fn sanitize_url(input: &str) -> String {
    sanitize_url_with_patterns(input, &[])
}

fn sanitize_text_with_patterns(input: &str, custom_patterns: &[String]) -> String {
    let bounded_input = truncate_with_marker(input, MAX_INPUT_CHARS);
    let redacted = redact_sensitive_substrings(&bounded_input, custom_patterns);
    truncate_with_marker(&redacted, MAX_TEXT_OUTPUT_CHARS)
}

fn sanitize_url_with_patterns(input: &str, custom_patterns: &[String]) -> String {
    // URL fragments are client-side only and commonly contain tokens or view
    // state. They have no value to Orbit's local timeline.
    let without_fragment = input.split('#').next().unwrap_or_default();
    let bounded_url = truncate_with_marker(without_fragment, MAX_INPUT_CHARS);
    let without_userinfo = redact_url_userinfo(&bounded_url);

    let (base, query) = match without_userinfo.split_once('?') {
        Some((base, query)) => (base, Some(query)),
        None => (without_userinfo.as_str(), None),
    };
    let mut sanitized_url = redact_sensitive_substrings(base, custom_patterns);

    if let Some(query) = query {
        let sanitized_query = query
            .split('&')
            .filter(|part| !part.is_empty())
            .map(|part| sanitize_query_parameter(part, custom_patterns))
            .collect::<Vec<_>>()
            .join("&");
        if !sanitized_query.is_empty() {
            sanitized_url.push('?');
            sanitized_url.push_str(&sanitized_query);
        }
    }

    truncate_with_marker(&sanitized_url, MAX_URL_OUTPUT_CHARS)
}

fn sanitize_query_parameter(part: &str, custom_patterns: &[String]) -> String {
    let (name, value) = match part.split_once('=') {
        Some((name, value)) => (name, Some(value)),
        None => (part, None),
    };
    let sanitized_name = redact_sensitive_substrings(name, custom_patterns);

    if is_sensitive_query_parameter(name) {
        return match value {
            Some(_) => format!("{sanitized_name}=[REDACTED:query_parameter]"),
            None => format!("{sanitized_name}=[REDACTED:query_parameter]"),
        };
    }

    match value {
        Some(value) => format!(
            "{sanitized_name}={}",
            redact_sensitive_substrings(value, custom_patterns)
        ),
        None => sanitized_name,
    }
}

fn is_sensitive_query_parameter(name: &str) -> bool {
    let normalized_name = name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    [
        "access",
        "apikey",
        "auth",
        "code",
        "credential",
        "key",
        "password",
        "secret",
        "session",
        "signature",
        "sig",
        "token",
    ]
    .iter()
    .any(|needle| normalized_name.contains(needle))
}

fn redact_url_userinfo(url: &str) -> String {
    let Some(scheme_end) = url.find("://") else {
        return url.to_string();
    };
    let authority_start = scheme_end + 3;
    let authority_end = url[authority_start..]
        .find(['/', '?'])
        .map(|offset| authority_start + offset)
        .unwrap_or(url.len());
    let authority = &url[authority_start..authority_end];

    if let Some(at_offset) = authority.rfind('@') {
        return format!(
            "{}[REDACTED:url_credentials]{}",
            &url[..authority_start],
            &url[authority_start + at_offset..]
        );
    }

    url.to_string()
}

fn redact_sensitive_substrings(input: &str, custom_patterns: &[String]) -> String {
    // A malformed/truncated PEM block is also unsafe. Do not store any of a
    // field containing a private-key header when the complete block is absent.
    if contains_private_key_marker(input) {
        return "[REDACTED:private_key]".to_string();
    }

    let mut redacted = input.to_string();
    redacted = connection_string_regex()
        .replace_all(&redacted, "[REDACTED:connection_string]")
        .into_owned();
    redacted = authorization_header_regex()
        .replace_all(&redacted, "[REDACTED:authorization]")
        .into_owned();
    redacted = credential_assignment_regex()
        .replace_all(&redacted, "$1=[REDACTED:credential]")
        .into_owned();
    redacted = api_key_regex()
        .replace_all(&redacted, |captures: &Captures<'_>| {
            format!("{}[REDACTED:api_key]", &captures[1])
        })
        .into_owned();
    redacted = jwt_regex()
        .replace_all(&redacted, "[REDACTED:jwt_token]")
        .into_owned();
    redacted = credit_card_regex()
        .replace_all(&redacted, "[REDACTED:credit_card]")
        .into_owned();
    redacted = ssn_regex()
        .replace_all(&redacted, "[REDACTED:ssn]")
        .into_owned();
    redacted = email_regex()
        .replace_all(&redacted, "[REDACTED:email]")
        .into_owned();
    redacted = phone_number_regex()
        .replace_all(&redacted, "[REDACTED:phone]")
        .into_owned();
    redacted = ethereum_address_regex()
        .replace_all(&redacted, "[REDACTED:crypto_address]")
        .into_owned();
    redacted = bitcoin_address_regex()
        .replace_all(&redacted, "[REDACTED:crypto_address]")
        .into_owned();

    for pattern in custom_patterns {
        redacted = redacted.replace(pattern, "[REDACTED:custom]");
    }
    redacted
}

fn is_valid_custom_pattern(pattern: &str) -> bool {
    !pattern.trim().is_empty()
        && pattern.chars().count() <= MAX_CUSTOM_PATTERN_CHARS
        && pattern != "[REDACTED:custom]"
}

fn truncate_with_marker(input: &str, maximum_characters: usize) -> String {
    let mut characters = input.chars();
    let truncated = characters
        .by_ref()
        .take(maximum_characters)
        .collect::<String>();
    if characters.next().is_some() {
        format!("{truncated}{TRUNCATED_MARKER}")
    } else {
        truncated
    }
}

fn contains_private_key_marker(input: &str) -> bool {
    [
        "BEGIN PRIVATE KEY",
        "BEGIN RSA PRIVATE KEY",
        "BEGIN EC PRIVATE KEY",
        "BEGIN OPENSSH PRIVATE KEY",
    ]
    .iter()
    .any(|marker| input.contains(marker))
}

fn connection_string_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r#"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s"'<>]+"#)
            .unwrap()
    })
}

fn authorization_header_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?im)\b(?:proxy-)?authorization\s*:\s*(?:bearer|basic|token)?\s*[^\s,;]+")
            .unwrap()
    })
}

fn credential_assignment_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r#"(?i)\b(password|passwd|pwd|secret|api[_-]?key|token|auth(?:orization)?|credential|client[_-]?secret)\s*[:=]\s*["']?[^\s,;"'&]+"#,
        )
        .unwrap()
    })
}

fn api_key_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        let mut prefixes = KNOWN_API_KEY_PREFIXES
            .iter()
            .map(|prefix| regex::escape(prefix))
            .collect::<Vec<_>>();
        prefixes.sort_by_key(|prefix| std::cmp::Reverse(prefix.len()));
        Regex::new(&format!(
            r"(?i)(^|[^A-Za-z0-9_])(?:{})[A-Za-z0-9._-]{{8,}}",
            prefixes.join("|")
        ))
        .unwrap()
    })
}

fn jwt_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"eyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}").unwrap()
    })
}

fn credit_card_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b").unwrap())
}

fn ssn_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\b\d{3}-\d{2}-\d{4}\b").unwrap())
}

fn email_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b").unwrap())
}

fn phone_number_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?:\+?1[-.\s]?)?(?:\(?[2-9]\d{2}\)?[-.\s]?)\d{3}[-.\s]\d{4}\b").unwrap()
    })
}

fn ethereum_address_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\b0x[a-fA-F0-9]{40}\b").unwrap())
}

fn bitcoin_address_regex() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"\b(?:1[a-km-zA-HJ-NP-Z1-9]{25,61}|3[a-km-zA-HJ-NP-Z1-9]{25,61}|bc1[a-z0-9]{23,59})\b",
        )
        .unwrap()
    })
}

#[cfg(test)]
mod tests {
    use super::{sanitize_text, sanitize_text_with_patterns, sanitize_url};

    #[test]
    fn redacts_secrets_inline_without_losing_surrounding_context() {
        let value = concat!("Deploy with token=sk", "-examplevalue123456 and continue.");
        assert_eq!(
            sanitize_text(value),
            "Deploy with token=[REDACTED:credential] and continue."
        );
    }

    #[test]
    fn redacts_private_keys_and_authorization_headers() {
        let private_key = "note -----BEGIN PRIVATE KEY----- incomplete";
        assert_eq!(sanitize_text(private_key), "[REDACTED:private_key]");
        assert_eq!(
            sanitize_text("Authorization: Bearer syntheticCredentialValue123"),
            "[REDACTED:authorization]"
        );
    }

    #[test]
    fn redacts_personal_and_payment_identifiers() {
        let value = "contact person@example.test at +1 415-555-2671; card 4111 1111 1111 1111; SSN 123-45-6789";
        assert_eq!(
            sanitize_text(value),
            "contact [REDACTED:email] at [REDACTED:phone]; card [REDACTED:credit_card]; SSN [REDACTED:ssn]"
        );
    }

    #[test]
    fn removes_fragments_and_sensitive_url_parts() {
        assert_eq!(
            sanitize_url("https://person:pass@example.test/path?q=orbit&access_token=hidden#never-store"),
            "https://[REDACTED:url_credentials]@example.test/path?q=orbit&access_token=[REDACTED:query_parameter]"
        );
    }

    #[test]
    fn redacts_user_configured_exact_phrases() {
        let patterns = vec!["Project Cypress".to_string()];
        assert_eq!(
            sanitize_text_with_patterns("Discuss Project Cypress milestones", &patterns),
            "Discuss [REDACTED:custom] milestones"
        );
    }

    #[test]
    fn sanitizes_window_titles_file_paths_and_screen_text() {
        let custom_patterns = vec!["Project Cypress".to_string()];
        assert_eq!(
            sanitize_text_with_patterns(
                concat!("Editor — API_KEY=sk", "-windowvalue123456"),
                &custom_patterns
            ),
            "Editor — API_KEY=[REDACTED:credential]"
        );
        assert_eq!(
            sanitize_text_with_patterns(
                "/Users/example/Project Cypress/notes.txt",
                &custom_patterns
            ),
            "/Users/example/[REDACTED:custom]/notes.txt"
        );
        assert_eq!(
            sanitize_text_with_patterns("Visible text: person@example.test", &custom_patterns),
            "Visible text: [REDACTED:email]"
        );
    }

    #[test]
    fn bounds_large_values_after_redaction() {
        let value = "x".repeat(20_000);
        let sanitized = sanitize_text(&value);
        assert!(sanitized.ends_with("[TRUNCATED]"));
        assert_eq!(sanitized.chars().count(), 16_395);
    }
}
