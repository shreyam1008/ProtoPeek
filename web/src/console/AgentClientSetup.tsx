import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { agentClientConfig, agentClients } from './agent-client-config';
import { type AgentClient, agentClientIds } from './agent-client-kind';

export function AgentClientSetup({
  initialClient,
  executable,
  connectionFile,
  copied,
  onCopy,
}: {
  initialClient: AgentClient;
  executable: string;
  connectionFile: string;
  copied: boolean;
  onCopy: (config: string) => void;
}) {
  const [client, setClient] = useState(initialClient);
  const [pathCommand, setPathCommand] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState('');
  const profile = agentClients[client];
  const command = pathCommand ? 'protopeek' : executable;
  const setup = agentClientConfig(client, command, connectionFile);
  return (
    <section className="pp-agent-client" aria-label="MCP client configuration">
      <label>
        Agent client
        <select value={client} onChange={(event) => setClient(event.target.value as AgentClient)}>
          {agentClientIds.map((id) => (
            <option key={id} value={id}>
              {agentClients[id].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        ProtoPeek executable
        <select
          value={pathCommand ? 'path' : 'observed'}
          onChange={(event) => setPathCommand(event.target.value === 'path')}
        >
          <option value="observed">Running workbench binary</option>
          <option value="path">Use protopeek from my client’s PATH</option>
        </select>
      </label>
      <p className="pp-agent-caption">
        {pathCommand
          ? 'Your client must resolve protopeek on its own PATH.'
          : 'Uses the executable reported by this running workbench.'}{' '}
        Run the client on this host; paths from Windows do not automatically work in WSL or
        containers.
      </p>
      <div className="pp-agent-code-title">
        <strong>{client === 'codex' ? 'TOML' : 'JSON'} merge fragment</strong>
        <button
          type="button"
          disabled={!setup}
          onClick={() => {
            if (setup) {
              setCopiedConfig(setup);
              onCopy(setup);
            }
          }}
          aria-label="Copy MCP configuration"
        >
          {copied && copiedConfig === setup ? (
            <Check aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </button>
      </div>
      <p>
        Merge into <code>{profile.file}</code> at <code>{profile.key}</code>. Keep your other
        settings.
      </p>
      {setup ? (
        <figure aria-label="MCP configuration">
          <pre>{setup}</pre>
        </figure>
      ) : (
        <p role="status">
          {!connectionFile.trim()
            ? 'Pairing file unavailable. Refresh this workbench before copying a configuration.'
            : 'Executable unavailable. Refresh, or explicitly choose the PATH command above.'}
        </p>
      )}
      <p className="pp-agent-caption">
        Keep machine paths and the connection file private. Keep ProtoPeek running; refresh this
        fragment after restarting. Your client may ask you to approve this MCP server and individual
        tools.
      </p>
      {profile.docs ? (
        <p className="pp-agent-caption">
          <a href={profile.docs} target="_blank" rel="noreferrer">
            {profile.label} setup documentation
          </a>
          . Format checked 23 October 2026; native client connection not verified here.
        </p>
      ) : null}
      <p className="pp-agent-caption">
        ChatGPT web does not read local STDIO configuration. Use a local MCP client for this
        connection.
      </p>
    </section>
  );
}
