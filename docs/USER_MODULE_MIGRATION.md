# User module v2 deployment

The user module now uses:

- global, code-controlled permission definitions;
- company-scoped roles;
- company memberships separate from user identity;
- membership-aware access and refresh tokens;
- verified email changes, password reset, session management, and audit logs.

## Local or staging

```bash
npm run audit:user-module
npm run migrate:user-module
npm run audit:user-module
npm test
```

The first migration intentionally revokes legacy refresh sessions because their
claims do not contain membership or session identifiers. Users sign in again
once. A migration marker prevents later deployments from repeating this reset.

## Render

1. Back up the production MongoDB database.
2. Deploy the backend code.
3. Run `npm run audit:user-module` in the Render backend shell.
4. Confirm that `blockers` is empty.
5. Run `npm run migrate:user-module`.
6. Run `npm run audit:user-module` again. All `*ToCreate`,
   `*ToMigrate`, `sessionsToRevoke`, and `blockers` values should be zero.
7. Deploy the frontend.

`seedPermissions.js` and `seedInventoryPermissions.js` were intentionally
removed. Use `npm run sync:permissions` whenever the application permission
catalogue changes. Companies assign those protected definitions to their roles
from the Roles & Permissions screen.

## Required environment variables

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `OTP_SECRET` (recommended; otherwise the refresh-token secret is used)
- `CLIENT_URL`
- `SAME_SITE` (`lax`, `strict`, or `none`)
- `COOKIE_DOMAIN` (production only; omit for localhost)
- existing mail transport variables used by `utils/sendMail.js`

