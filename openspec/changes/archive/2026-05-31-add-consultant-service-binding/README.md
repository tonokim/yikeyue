# Change: add-consultant-service-binding

Implementation references design decisions from [design.md](./design.md):

- **D1: Joint Primary Key on `(consultant_id, service_id)`** - Defined in `apps/server/src/db/schema.ts` as composite primary key.
- **D2: Same Store Constraint** - Ensured in `replaceServices` via explicit service layer query and store boundary check.
- **D3: Replacement PUT Edit** - Implemented `PUT /store-admin/consultants/:consultantId/services` with differential add/delete updates.
- **D4: Write-time Intercept** - Blocks binding if consultant has left (status = 'left') or service is inactive (status = 'inactive').
- **D5: Read Endpoints Filtering** -
  - B-side list services: does not filter status.
  - B-side list consultants: filters for active consultants.
  - C-side list consultants: filters for active consultants, active service, online store.
  - C-side list services: filters for active services, active consultant, online store.
- **D6: IDOR Protection** - Explicitly scopes queries by store ID (from session/token) for both consultant and service references.
- **D7: Error Code Namespace** - Uses `consultant_service.<snake_case>` namespace for all business errors.
- **D8: DB Secondary Index** - Created secondary index `idx_consultant_service_service_id` on the `service_id` column to optimize reverse queries.
