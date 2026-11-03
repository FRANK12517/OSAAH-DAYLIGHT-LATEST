# Authentication regression protection

## Authentication regression contract

The browser submits school credentials as JSON to `POST /api/auth/login`. Login success requires an HTTP success response, a JSON response with a user, the server-issued `osaah_session` cookie, and the server-selected route. Non-JSON and malformed JSON responses produce a safe sign-in error. A response body alone never authenticates a user. The server normalizes the identifier, verifies the password against the configured persistence adapter, checks account eligibility, resolves the canonical role and permissions server side, and issues the `osaah_session` cookie. The cookie is HTTP-only and uses `SameSite=Lax`; production responses include `Secure`. Session records use durable storage when the configured adapter supports it. `GET /api/auth/session` restores the authenticated user and server-selected destination. `POST /api/auth/logout` revokes the session and clears the cookie.

Role keys and landing routes are defined by `SCHOOL_PORTAL_DASHBOARDS` in `src/auth.js`:

| Role key | Destination |
| --- | --- |
| `PROPRIETOR` | `/` |
| `SCHOOL_ADMIN` | `/settings` |
| `HEADTEACHER` | `/academics` |
| `ASSISTANT_HEADTEACHER` | `/academics` |
| `ACCOUNTANT_BURSAR` | `/fees` |
| `TEACHER` | `/academics` |

The application uses the existing single-school identity. Protected APIs must authorize from the server-resolved actor and permissions; client route visibility is not an authorization boundary.

## Local verification

Run the focused authentication API, frontend response, session, and role-routing suite with:

```sh
npm run test:auth-regression
```

Run the isolated Playwright staff role matrix with generated synthetic users and credentials using:

```sh
npx playwright install chromium
OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS=1 node --test test/staff-role-auth-browser.test.js
```

On Windows PowerShell, set the environment variable with `$env:OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS = '1'` before running the test. The browser test creates synthetic accounts in process and does not use production identities.

## Production smoke tests

The `Production authentication smoke test` workflow is manual (`workflow_dispatch`) and uses the protected GitHub `production` environment. It requires production identifiers and passwords to be configured as environment secrets. It uses a fresh browser context per role, verifies the server-resolved user and role through `/api/auth/session`, secure session-cookie attributes, the role route and sidebar data, a protected cross-role API, refresh persistence, and logout. The workflow stops at the first failing account to avoid repeated attempts. It performs no school-record writes. Do not put production credentials in source, command-line arguments, test output, screenshots, artifacts, or secrets available to ordinary pull requests.

Configure these environment secrets before dispatch: `PROD_PROPRIETOR_IDENTIFIER`, `PROD_PROPRIETOR_PASSWORD`, `PROD_ADMINISTRATOR_IDENTIFIER`, `PROD_ADMINISTRATOR_PASSWORD`, `PROD_HEADTEACHER_IDENTIFIER`, `PROD_HEADTEACHER_PASSWORD`, `PROD_ASSISTANT_HEADTEACHER_IDENTIFIER`, `PROD_ASSISTANT_HEADTEACHER_PASSWORD`, `PROD_ACCOUNTANT_IDENTIFIER`, `PROD_ACCOUNTANT_PASSWORD`, `PROD_TEACHER_USERNAME`, `PROD_TEACHER_EMAIL`, and `PROD_TEACHER_PASSWORD`.

No production root cause is asserted by this repository contract. The local frontend previously parsed login responses without checking the content type. The local `/api/auth/login` handler already catches authentication errors and returns JSON; identifying a production proxy, deployment, database, or configuration failure requires live response and deployment evidence. Record only role, identifier type, result category, HTTP status, route, and sanitized diagnostics.

For an approved, time-limited production session investigation, set `OSAAH_AUTH_SESSION_DIAGNOSTICS=1` in the protected Production environment and release the diagnostic build through the normal reviewed deployment process. The server logs cookie attributes without the cookie value, HMAC key configuration fingerprint, process/request/deployment correlation, a fingerprint of the configured database target, credential parsing result, signature outcome, token and session-ID fingerprints, durable-store lookup outcome, record-state classification, restored role category, and authorization result. Fingerprints are truncated SHA-256 digests and cannot be used as session credentials. The record classification query is read-only and is restricted to the hash of the presented session token. Do not enable broad request/body logging. Remove the diagnostic environment flag after the controlled test and retain only the sanitized report in access-controlled logs.

## CI release gate

The `Verify protected components` workflow runs `npm run test:auth-regression` and the Playwright synthetic staff-role matrix on pull requests and pushes to `main`. It installs Chromium before running browser regressions. A failed assertion fails the workflow. Repository branch protection must require the `Verify attendance integrity and protected components` job before merge; GitHub repository settings control that requirement and it cannot be established by workflow YAML alone.
# Role dashboard navigation protection

The school role navigation contract is protected by `school-authentication-login-contract` in `config/protected-components.json`. The protected contract includes sidebar route identity (`navigationKey`), exact view identity, the proprietor route registry, the synthetic browser matrix, the app asset cache version, and bounded iframe loading with an explicit error state.

The browser matrix uses generated local accounts only. For each configured school role it verifies the role landing page, opens that role's first visible sidebar module, checks the URL's navigation and view keys, and confirms the iframe renders the same module and exact view before checking authorization, session restore, and logout. The proprietor's full 160 route mapping also remains covered by the proprietor route tests. Production credentials must only be used through the separately authorized production smoke workflow; they must not be committed into tests, logs, or source.

Run `npm run protection:verify`, `npm run test:auth-regression`, and `OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS=1 node --test --test-concurrency=1 test/staff-role-auth-browser.test.js` before changing login redirects, sidebar identities, or embedded module navigation.
