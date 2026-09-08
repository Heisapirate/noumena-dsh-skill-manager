# Install is GitHub-scoped; well-known sources surface as unavailable

Install, update, and uninstall operate only on skills whose skills.sh `source` is a GitHub `owner/repo`, because the anonymous `/api/download/{owner}/{repo}/{slug}` endpoint resolves those and only those. Skills from "well-known" (domain) sources still appear in search results, but attempting to install one renders the required **unavailable source** state rather than the plugin implementing the RFC 8615 `/.well-known/` discovery flow.

This keeps the deliverable's scope proportional: well-known discovery can be added later without changing the manifest schema or the path-safety model. The exam's own reference skill (`vercel-labs/skills/find-skills`) is a GitHub source, so the required feature set is fully exercisable under this boundary.
