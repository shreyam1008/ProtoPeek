# auth.md

ProtoPeek's public site contains documentation for a local workbench. Its
discovery resources are anonymous and require no account, OAuth token, API key,
or agent registration.

The workbench's protocol calls, network probes, host integrations, and local
agent/CLI features run on the user's computer. The public website does not
expose a hosted service proxy, remote MCP endpoint, or OAuth authorization
server. Do not put private targets, credentials, or Tailscale data in public
requests to this site.

```yaml
agent_auth:
  registration_required: false
  identity_types_supported: [anonymous]
  credential_types_supported: [none]
  protected_resources: []
  authorization_servers: []
```
