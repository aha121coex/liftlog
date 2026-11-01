# Google sync prototype — paused

The user has removed cloud sync from current requirements. Development is paused in favor of local data plus user-initiated file sharing. No Google OAuth setup is needed. The remaining design below is historical and is not a release requirement for local-only LiftLog. Production authentication and sync remain blocked. No production workout cells have been read or changed.

`sync-protocol.js` is a standalone experimental journal and durable-outbox core, deliberately not loaded by index.html or used by the legacy Google adapter. It supports immutable entity versions, parent references, explicit tombstones, checksums, duplicate operation deduplication, preserved conflicting heads, serialized durable mutations, reconciliation after ambiguous responses and verified readback before clearing pending work.

Synthetic tests cover concurrent edits, deletion/edit conflicts, duplicate appends, corrupt operations, missing parents, lost responses, edits during an upload, asynchronous local persistence and absent remote acknowledgement. Passing these tests establishes behavior of this core, not Google authentication, existing-Sheet migration or an integrated app.

Remaining work:
1. Implement and validate full workout/exercise/routine payload schemas and remote journal headers. Test cycles, cross-entity parents, journal truncation and local acknowledgement failures.
2. Add a Google Sheets journal adapter using RAW appends. Bind it to the durable local outbox and an explicit per-file grant. Operation checksums detect corruption, not malicious edits or authenticity.
3. Design migration and readable projections of the existing five tabs without overwriting concurrent direct Sheet edits. ChatGPT changes to existing routine cells must be captured explicitly; the journal alone does not ingest them.
4. Integrate conflict previews and explicit resolutions into the offline app. Restore must never replay stale pending operations or use the previous device identity accidentally.
5. Test least-privilege Google OAuth against a disposable private Sheet. Required external configuration: a public Google OAuth web client ID and authorized JavaScript origins. Never request or store its client secret. Changing scopes alone does not grant access to the existing private file.
6. Verify real iPhone Safari and standalone consent, expiry, denial, offline recovery and updates. Only then propose production enablement for review.

The connected Google Drive authorization in ChatGPT is separate from browser OAuth and cannot certify the app's Google sign-in flow.
