export interface SearchEngineConfig {
  hostnamePattern: RegExp;
  pathPattern: RegExp;
  queryParam: string;
  engineName: string;
}

// Ordered by approximate usage frequency. DuckDuckGo uses pathPattern /.*/
// because its results sit at the root path with query params (?q=…).
export const SEARCH_ENGINE_CONFIGS: SearchEngineConfig[] = [
  {
    hostnamePattern: /\bgoogle\.[a-z.]+$/,
    pathPattern:     /^\/search/,
    queryParam:      "q",
    engineName:      "Google",
  },
  {
    hostnamePattern: /\byoutube\.com$/,
    pathPattern:     /^\/results/,
    queryParam:      "search_query",
    engineName:      "YouTube",
  },
  {
    hostnamePattern: /\bbing\.com$/,
    pathPattern:     /^\/search/,
    queryParam:      "q",
    engineName:      "Bing",
  },
  {
    hostnamePattern: /\bduckduckgo\.com$/,
    pathPattern:     /.*/,
    queryParam:      "q",
    engineName:      "DuckDuckGo",
  },
];

export interface DetectedSearch {
  query: string;
  engineName: string;
}

export function detectSearchQuery(pageUrl: string): DetectedSearch | null {
  const currentUrl = new URL(pageUrl);
  for (const config of SEARCH_ENGINE_CONFIGS) {
    if (
      config.hostnamePattern.test(currentUrl.hostname) &&
      config.pathPattern.test(currentUrl.pathname)
    ) {
      const query = currentUrl.searchParams.get(config.queryParam);
      if (query) {
        return { query, engineName: config.engineName };
      }
    }
  }
  return null;
}
