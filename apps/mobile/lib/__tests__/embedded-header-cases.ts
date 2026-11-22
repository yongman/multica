/** Shared expectations for the sanitizer, live preview and final native Text. */
export const embeddedHeaderCases = [
  {
    name: "sh -c with double outer and single inner quotes",
    command: `sh -c "curl -H 'Authorization: Basic opaque-basic' -H 'Cookie: session=opaque-cookie' -H 'X-API-Key: opaque-api' -H 'Accept: application/json' --verbose https://example.test" -- outer`,
    safe: `sh -c "curl -H 'Authorization: [REDACTED]' -H 'Cookie: [REDACTED]' -H 'X-API-Key: [REDACTED]' -H 'Accept: application/json' --verbose https://example.test" -- outer`,
  },
  {
    name: "absolute bash -lc with single outer and double inner quotes",
    command: `/bin/bash -lc 'curl -H "Authorization: Basic opaque-basic" -H "Cookie: session=opaque-cookie" -H "X-API-Key: opaque-api" -H "Accept: application/json" --verbose https://example.test' -- outer`,
    safe: `/bin/bash -lc 'curl -H "Authorization: [REDACTED]" -H "Cookie: [REDACTED]" -H "X-API-Key: [REDACTED]" -H "Accept: application/json" --verbose https://example.test' -- outer`,
  },
  {
    name: "sh -c with escaped double quotes",
    command: String.raw`sh -c "curl -H \"Authorization: Basic opaque-basic\" -H \"Cookie: session=opaque-cookie\" -H \"X-API-Key: opaque-api\" -H \"Accept: application/json\" --verbose https://example.test" -- outer`,
    safe: String.raw`sh -c "curl -H \"Authorization: [REDACTED]\" -H \"Cookie: [REDACTED]\" -H \"X-API-Key: [REDACTED]\" -H \"Accept: application/json\" --verbose https://example.test" -- outer`,
  },
  {
    name: "bash -lc with escaped single quotes",
    command: String.raw`bash -lc 'curl -H '\''Authorization: Basic opaque-basic'\'' -H '\''Cookie: session=opaque-cookie'\'' -H '\''X-API-Key: opaque-api'\'' -H '\''Accept: application/json'\'' --verbose https://example.test' -- outer`,
    safe: String.raw`bash -lc 'curl -H '\''Authorization: [REDACTED]'\'' -H '\''Cookie: [REDACTED]'\'' -H '\''X-API-Key: [REDACTED]'\'' -H '\''Accept: application/json'\'' --verbose https://example.test' -- outer`,
  },
  {
    name: "zsh -c with split names, attached flags and escaped spaces",
    command: String.raw`/bin/zsh -c 'curl -H "Auth""orization: Basic opaque-basic" --header="X-API-""Key: opaque-api" -HCookie:\ session=opaque-cookie -H "Ac""cept: application/json" --verbose https://example.test' -- outer`,
    safe: String.raw`/bin/zsh -c 'curl -H "Authorization: [REDACTED]" --header="X-API-Key: [REDACTED]" -HCookie:[REDACTED] -H "Ac""cept: application/json" --verbose https://example.test' -- outer`,
  },
  {
    name: "nested bash -lc inside sh -c",
    command: String.raw`sh -c "bash -lc 'curl -H \"Authorization: Basic opaque-basic\" -H \"Cookie: session=opaque-cookie\" -H \"X-API-Key: opaque-api\" -H \"Accept: application/json\" --verbose https://example.test'" -- outer`,
    safe: String.raw`sh -c "bash -lc 'curl -H \"Authorization: [REDACTED]\" -H \"Cookie: [REDACTED]\" -H \"X-API-Key: [REDACTED]\" -H \"Accept: application/json\" --verbose https://example.test'" -- outer`,
  },
];
