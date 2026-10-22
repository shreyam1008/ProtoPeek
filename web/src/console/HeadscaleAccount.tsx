import { useState } from 'react';

export function HeadscaleAccount({
  busy,
  accountsObserved,
  onPrepare,
}: {
  busy: boolean;
  accountsObserved: boolean;
  onPrepare: (url: string) => void;
}) {
  const [server, setServer] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="pp-tailnet-custom"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        try {
          const url = new URL(server.trim());
          if (
            url.protocol !== 'https:' ||
            !url.hostname ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            throw new Error();
          setError('');
          onPrepare(url.toString());
        } catch {
          setError('Enter an HTTPS control-server URL without credentials, query or fragment.');
        }
      }}
    >
      <h3>Headscale / custom control server</h3>
      <p>
        Add a separate Tailscale account. Complete sign-in in the installed client; the previous
        account is kept. ProtoPeek does not administer Headscale.
      </p>
      <label>
        Control-server URL{' '}
        <input
          type="url"
          required
          maxLength={2048}
          placeholder="https://headscale.example.test"
          value={server}
          onChange={(event) => {
            setServer(event.target.value);
            setError('');
          }}
          aria-invalid={!!error}
        />
      </label>
      <button type="submit" disabled={busy || !accountsObserved || !server.trim()}>
        Review custom login
      </button>
      {!accountsObserved ? (
        <p>Refresh the saved account list before adding a custom login.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
