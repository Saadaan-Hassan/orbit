use chrono::Utc;
use regex::Regex;
use sqlx::SqlitePool;
use std::sync::OnceLock;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Compiled regexes — initialised once and reused on every poll
// ---------------------------------------------------------------------------

// Matches 13–19 contiguous digits, optionally broken into groups of up to 4
// by single spaces or dashes. Handles both "4111 1111 1111 1111" and
// "4111111111111111" forms without false-positiving on phone numbers
// (which are shorter and typically have different grouping).
fn credit_card_regex() -> &'static Regex {
    static CREDIT_CARD_PATTERN: OnceLock<Regex> = OnceLock::new();
    CREDIT_CARD_PATTERN.get_or_init(|| {
        Regex::new(r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,7}\b").unwrap()
    })
}

// Matches the canonical US Social Security Number format: 123-45-6789.
fn ssn_regex() -> &'static Regex {
    static SSN_PATTERN: OnceLock<Regex> = OnceLock::new();
    SSN_PATTERN.get_or_init(|| {
        Regex::new(r"\b\d{3}-\d{2}-\d{4}\b").unwrap()
    })
}

// Matches an Ethereum address: 0x followed by exactly 40 hex characters.
fn ethereum_address_regex() -> &'static Regex {
    static ETHEREUM_PATTERN: OnceLock<Regex> = OnceLock::new();
    ETHEREUM_PATTERN.get_or_init(|| {
        Regex::new(r"\b0x[a-fA-F0-9]{40}\b").unwrap()
    })
}

// ---------------------------------------------------------------------------
// API key prefixes that unambiguously identify a secret token
// ---------------------------------------------------------------------------

// Checked via str::starts_with — no regex needed, faster and unambiguous.
const KNOWN_API_KEY_PREFIXES: &[&str] = &[
    "sk-",       // OpenAI / Anthropic secret keys
    "AIza",      // Google API keys
    "AKIA",      // AWS Access Key IDs
    "xoxb-",     // Slack bot tokens
    "ghp_",      // GitHub personal access tokens
    "gho_",      // GitHub OAuth tokens
    "ghs_",      // GitHub server-to-server tokens
    "pk_live_",  // Stripe publishable live keys
    "sk_live_",  // Stripe secret live keys
    "pk_test_",  // Stripe publishable test keys
    "sk_test_",  // Stripe secret test keys
    "pa-",       // Voyage AI / PaLM API keys
];

// PEM header fragments that identify a private key block.
const PEM_PRIVATE_KEY_MARKERS: &[&str] = &[
    "BEGIN PRIVATE KEY",
    "BEGIN RSA PRIVATE KEY",
    "BEGIN EC PRIVATE KEY",
    "BEGIN OPENSSH PRIVATE KEY",
];

// ---------------------------------------------------------------------------
// Redaction detector
// ---------------------------------------------------------------------------

/// Inspects `clipboard_text` and returns the category name of the first
/// sensitive pattern found, or `None` if the content is safe to store.
///
/// Patterns are checked in descending order of risk. The function returns
/// on the first match so only one category is ever reported per clipboard
/// entry — no double-tagging.
pub fn detect_sensitive_content_type(clipboard_text: &str) -> Option<&'static str> {
    // 1. PEM private keys — highest severity; check before API keys because
    //    PEM blocks sometimes start with "-----" which has no common prefix.
    for pem_marker in PEM_PRIVATE_KEY_MARKERS {
        if clipboard_text.contains(pem_marker) {
            return Some("private_key");
        }
    }

    // 2. Known API key prefixes — check both:
    //    (a) the trimmed line starts with a prefix (bare token was copied), and
    //    (b) the prefix appears anywhere in the text after a word boundary such
    //        as "KEY=AIza..." or "export SK=sk-...". This catches `.env` line
    //        copies like `GEMINI_API_KEY=Gdb23782....` where the
    //        prefix is not at position 0.
    let trimmed_clipboard_text = clipboard_text.trim();
    for api_key_prefix in KNOWN_API_KEY_PREFIXES {
        if trimmed_clipboard_text.starts_with(api_key_prefix) {
            return Some("api_key");
        }
        // Scan every word boundary: split on common assignment/separator chars
        // and check whether any resulting token starts with the prefix.
        let contains_prefixed_token = trimmed_clipboard_text
            .split(|separator_char: char| {
                matches!(separator_char, '=' | ':' | ' ' | '\t' | '\n' | '"' | '\'')
            })
            .any(|token| token.starts_with(api_key_prefix));
        if contains_prefixed_token {
            return Some("api_key");
        }
    }

    // 3. JWT tokens — three base64url segments separated by dots, no spaces,
    //    each segment at least 10 characters. This form is unambiguous enough
    //    without a full base64 decode.
    let jwt_segments: Vec<&str> = trimmed_clipboard_text.split('.').collect();
    let looks_like_jwt = jwt_segments.len() == 3
        && !trimmed_clipboard_text.contains(' ')
        && jwt_segments.iter().all(|segment| segment.len() >= 10);
    if looks_like_jwt {
        return Some("jwt_token");
    }

    // 4. Credit card numbers — regex match anywhere in the text so partial
    //    pastes (e.g. a CSV row containing a card number) are also caught.
    if credit_card_regex().is_match(clipboard_text) {
        return Some("credit_card");
    }

    // 5. SSN — US Social Security Number format: 123-45-6789.
    if ssn_regex().is_match(clipboard_text) {
        return Some("ssn");
    }

    // 6. Ethereum addresses — 0x + 40 hex chars.
    if ethereum_address_regex().is_match(clipboard_text) {
        return Some("crypto_address");
    }

    // 7. Bitcoin addresses — P2PKH (starts with "1"), P2SH (starts with "3"),
    //    or Bech32 (starts with "bc1"). 26–62 base58/bech32 characters, no spaces.
    let is_bitcoin_address = !trimmed_clipboard_text.contains(' ')
        && (trimmed_clipboard_text.len() >= 26 && trimmed_clipboard_text.len() <= 62)
        && (trimmed_clipboard_text.starts_with('1')
            || trimmed_clipboard_text.starts_with('3')
            || trimmed_clipboard_text.starts_with("bc1"));
    if is_bitcoin_address {
        return Some("crypto_address");
    }

    None
}

// ---------------------------------------------------------------------------
// Clipboard polling loop
// ---------------------------------------------------------------------------

pub async fn start_clipboard_monitor(
    sqlite_database_path: String,
    sqlx_connection_pool: SqlitePool,
) {
    let mut last_seen_clipboard_text = String::new();

    loop {
        // arboard::Clipboard is !Send and cannot be held across .await points,
        // so we create it and read inside spawn_blocking on each poll.
        let clipboard_read_result =
            tokio::task::spawn_blocking(|| match arboard::Clipboard::new() {
                Ok(mut clipboard_handle) => clipboard_handle.get_text().ok(),
                Err(_) => None,
            })
            .await;

        let maybe_clipboard_text = match clipboard_read_result {
            Ok(value) => value,
            Err(join_error) => {
                eprintln!("Clipboard spawn_blocking task failed: {join_error}");
                None
            }
        };

        if let Some(current_clipboard_text) = maybe_clipboard_text {
            let is_non_empty = !current_clipboard_text.is_empty();
            let is_new_content = current_clipboard_text != last_seen_clipboard_text;

            if is_non_empty && is_new_content {
                last_seen_clipboard_text = current_clipboard_text.clone();

                // Check for sensitive content before any DB write.
                // If the text matches a known secret pattern, store only the
                // redaction placeholder — never the raw value.
                let content_to_store =
                    match detect_sensitive_content_type(&current_clipboard_text) {
                        Some(sensitive_content_type) => {
                            format!("[REDACTED:{sensitive_content_type}]")
                        }
                        None => current_clipboard_text.clone(),
                    };

                let new_event_id = Uuid::new_v4().to_string();
                let event_timestamp_milliseconds = Utc::now().timestamp_millis();

                let insert_result = sqlx::query(
                    "INSERT INTO events (id, timestamp, type, raw_content, app_name, url, source)
                     VALUES (?, ?, 'clipboard', ?, NULL, NULL, 'rust')",
                )
                .bind(&new_event_id)
                .bind(event_timestamp_milliseconds)
                .bind(&content_to_store)
                .execute(&sqlx_connection_pool)
                .await;

                if let Err(database_error) = insert_result {
                    eprintln!(
                        "Failed to write clipboard event to SQLite (path: {sqlite_database_path}): \
                         {database_error}"
                    );
                }
            }
        }

        sleep(Duration::from_millis(500)).await;
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::detect_sensitive_content_type;

    #[test]
    fn detects_pem_private_key() {
        let pem_text = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkq...\n-----END PRIVATE KEY-----";
        assert_eq!(detect_sensitive_content_type(pem_text), Some("private_key"));
    }

    #[test]
    fn detects_openai_api_key() {
        assert_eq!(detect_sensitive_content_type("sk-abc123XYZ"), Some("api_key"));
    }

    #[test]
    fn detects_anthropic_api_key() {
        assert_eq!(detect_sensitive_content_type("sk-ant-api03-abc123"), Some("api_key"));
    }

    #[test]
    fn detects_github_pat() {
        assert_eq!(detect_sensitive_content_type("ghp_16C7e42F292c6912E7710c838347Ae178B4a"), Some("api_key"));
    }

    #[test]
    fn detects_jwt_token() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        assert_eq!(detect_sensitive_content_type(jwt), Some("jwt_token"));
    }

    #[test]
    fn detects_credit_card() {
        assert_eq!(detect_sensitive_content_type("4111 1111 1111 1111"), Some("credit_card"));
        assert_eq!(detect_sensitive_content_type("4111111111111111"), Some("credit_card"));
    }

    #[test]
    fn detects_ssn() {
        assert_eq!(detect_sensitive_content_type("123-45-6789"), Some("ssn"));
    }

    #[test]
    fn detects_ethereum_address() {
        assert_eq!(
            detect_sensitive_content_type("0xAbCd1234567890abcdef1234567890ABCDEF1234"),
            Some("crypto_address"),
        );
    }

    #[test]
    fn detects_bitcoin_address() {
        assert_eq!(
            detect_sensitive_content_type("1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf Na"),
            None, // has a space — not detected as bitcoin
        );
        assert_eq!(
            detect_sensitive_content_type("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"),
            Some("crypto_address"),
        );
    }

    #[test]
    fn detects_env_file_line_with_api_key() {
        // Covers the real-world case: copying a .env line where the key
        // prefix appears after the variable name and equals sign.
        assert_eq!(
            detect_sensitive_content_type("GEMINI_API_KEY=AIzaSyCILTA5ES2dLDg8zBAfGt75JupFecH58F4"),
            Some("api_key"),
        );
        assert_eq!(
            detect_sensitive_content_type("export OPENAI_API_KEY=sk-proj-abc123"),
            Some("api_key"),
        );
        assert_eq!(
            detect_sensitive_content_type("STRIPE_SECRET=sk_live_abcdef123456"),
            Some("api_key"),
        );
    }

    #[test]
    fn safe_content_passes_through() {
        assert_eq!(detect_sensitive_content_type("hello world"), None);
        assert_eq!(detect_sensitive_content_type("fn main() { println!(\"hi\"); }"), None);
        assert_eq!(detect_sensitive_content_type("meeting notes from today"), None);
    }
}
