//! Runtime exclusion matching for native capture.
//!
//! SQLite is the single source of configured exclusions. This module only
//! canonicalizes values while comparing them, matching FastAPI's policy for
//! case, whitespace, `www.`, trailing dots, IDNA, ports, and subdomains.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use unicode_normalization::UnicodeNormalization;
use url::Url;

pub fn normalize_app_name(value: &str) -> String {
    value
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .map(|word| {
            word.chars()
                .flat_map(char::to_lowercase)
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn normalize_hostname(value: &str) -> Option<String> {
    let candidate = value.trim();
    if candidate.is_empty() {
        return None;
    }

    let url = if candidate.contains("://") {
        Url::parse(candidate).ok()?
    } else {
        Url::parse(&format!("https://{candidate}")).ok()?
    };
    let hostname = url.host_str()?.trim_end_matches('.');
    let hostname = hostname.strip_prefix("www.").unwrap_or(hostname);
    if hostname.is_empty() {
        None
    } else {
        Some(hostname.to_ascii_lowercase())
    }
}

pub fn domain_is_excluded(hostname_or_url: &str, excluded_domains: &HashSet<String>) -> bool {
    let Some(hostname) = normalize_hostname(hostname_or_url) else {
        return false;
    };
    excluded_domains.iter().any(|excluded_domain| {
        hostname == *excluded_domain || hostname.ends_with(&format!(".{excluded_domain}"))
    })
}

fn normalize_absolute_path(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }

    // `canonicalize` requires the path to exist. File-system events can be
    // removals, so normalize lexically instead and do not follow symlinks.
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Prefix(_) => return None,
        }
    }
    Some(normalized)
}

pub fn path_is_within_watched_folder(file_path: &Path, watched_folders: &[String]) -> bool {
    let Some(file_path) = normalize_absolute_path(file_path) else {
        return false;
    };
    watched_folders.iter().any(|folder| {
        normalize_absolute_path(Path::new(folder))
            .is_some_and(|normalized_folder| file_path.starts_with(normalized_folder))
    })
}

#[cfg(test)]
mod tests {
    use super::{
        domain_is_excluded, normalize_app_name, normalize_hostname, path_is_within_watched_folder,
    };
    use std::collections::HashSet;
    use std::path::Path;

    #[test]
    fn normalizes_exclusions_without_suffix_lookalikes() {
        let domains = HashSet::from(["example.com".to_string()]);
        assert_eq!(
            normalize_hostname("HTTPS://WWW.BÜCHER.Example.:443/path"),
            Some("xn--bcher-kva.example".to_string())
        );
        assert!(domain_is_excluded(
            "https://www.example.com/login",
            &domains
        ));
        assert!(domain_is_excluded("team.example.com", &domains));
        assert!(!domain_is_excluded("notexample.com", &domains));
    }

    #[test]
    fn app_and_folder_matching_are_case_and_boundary_safe() {
        assert_eq!(
            normalize_app_name("  KEYCHAIN   Access "),
            "keychain access"
        );
        assert!(path_is_within_watched_folder(
            Path::new("/Users/example/Documents/note.txt"),
            &["/Users/example/Documents".to_string()],
        ));
        assert!(!path_is_within_watched_folder(
            Path::new("/Users/example/Documents-old/note.txt"),
            &["/Users/example/Documents".to_string()],
        ));
    }
}
