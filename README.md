# Care Circle — Family Care Coordination

React / Express / tRPC / Drizzle starter, adapted from the Sandbox web-db-user template.

- `pnpm dev`: development server; honors `PORT` (default 3000).
- `pnpm build` / `pnpm start`: build and serve `dist/index.js` and `dist/public/`.
- `pnpm db:migrate`: apply checked-in migrations. `pnpm db:push`: generate and apply new schema changes.
- `pnpm check` / `pnpm test`: types and application tests.

Start with the Webdev skill's default-template guide. Platform login, storage, payments and service contracts live in its shared references; read the relevant capability before extending its helper.

`server/_core/publicConfig.ts` exposes only named public runtime values. Private keys stay server-side. The platform serves managed `/manus-storage/` assets; the application does not register a second proxy.

Platform configuration is readable and editable through `webdev.config`. Default settings are initial values, not enforced constraints. The agent may modify the files, commands and configuration or follow the flexible guide for another stack.

## Maintenance documentation

The independent maintenance runbook is in [`docs/CARE-CIRCLE-MAINTENANCE.md`](docs/CARE-CIRCLE-MAINTENANCE.md). The security and privacy review is in [`docs/SECURITY-PRIVACY-REVIEW.md`](docs/SECURITY-PRIVACY-REVIEW.md), and the measured Vite build results are documented in [`docs/BUILD-PERFORMANCE.md`](docs/BUILD-PERFORMANCE.md). The unapproved legal drafts are [`docs/PRIVACY-POLICY-DRAFT.md`](docs/PRIVACY-POLICY-DRAFT.md) and [`docs/TERMS-OF-USE-DRAFT.md`](docs/TERMS-OF-USE-DRAFT.md), with owner questions in [`docs/OWNER-DECISIONS-REQUIRED.md`](docs/OWNER-DECISIONS-REQUIRED.md). These documents contain no secrets and do not replace an OAuth, production-device, notification, or legal review.
