import { useEffect, useRef, useState } from 'react';
import {
  type HTTPEnvironment,
  type HTTPEnvironments,
  httpEnvironmentsKey,
  isHTTPSecretVariable,
  readHTTPEnvironments,
  saveHTTPEnvironments,
} from './http-environments';
import './http-tools.css';

export function HTTPEnvironmentControls({
  onChange,
}: {
  onChange: (profile: HTTPEnvironment | null) => void;
}) {
  const [initial] = useState(readHTTPEnvironments);
  const [value, setValue] = useState<HTTPEnvironments>(initial);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HTTPEnvironment | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editingId = editing?.id;
  useEffect(() => {
    if (editingId) nameRef.current?.focus();
  }, [editingId]);
  useEffect(() => {
    onChange(value.profiles.find((profile) => profile.id === value.selectedId) ?? null);
  }, [value, onChange]);
  useEffect(() => {
    const reload = (event: StorageEvent) => {
      if (event.key !== null && event.key !== httpEnvironmentsKey) return;
      const next = readHTTPEnvironments();
      setValue(next);
      setError(next.error);
      setEditing(null);
      setNotice('Profiles changed in another tab. Re-enter session secrets.');
    };
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, []);
  function update(next: HTTPEnvironments) {
    try {
      if (
        initial.error &&
        localStorage.getItem(httpEnvironmentsKey) !== null &&
        !value.profiles.length
      )
        throw new Error('Reset the unreadable profiles before saving.');
      const saved = saveHTTPEnvironments(next);
      setValue(saved);
      setError('');
      setNotice('Profiles saved. Secret values remain in this tab only.');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profiles could not be saved.');
      return false;
    }
  }
  function close() {
    setOpen(false);
    setEditing(null);
    triggerRef.current?.focus();
  }
  return (
    <div className="pp-http-environments" data-pp-shortcut-scope>
      <label>
        Environment{' '}
        <select
          aria-label="HTTP environment"
          value={value.selectedId}
          onChange={(event) => update({ ...value, selectedId: event.target.value })}
        >
          <option value="">No environment</option>
          {value.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setEditing(null);
        }}
      >
        Manage environments
      </button>
      {open ? (
        <section
          className="pp-http-tools-panel"
          aria-label="Manage HTTP environments"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <header>
            <strong>HTTP environments</strong>
            <button type="button" onClick={close}>
              Close
            </button>
          </header>
          <p>
            Use {'{{name}}'} in URL, params, headers or body. Secret variables work only in Auth and
            header values and must be re-entered after leaving HTTP or reloading.
          </p>
          <div className="pp-http-tools-actions">
            {value.profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                onClick={() => setEditing(structuredClone(profile))}
              >
                {profile.name}
              </button>
            ))}
            <button
              type="button"
              disabled={value.profiles.length >= 20}
              onClick={() => setEditing({ id: crypto.randomUUID(), name: '', variables: [] })}
            >
              New environment
            </button>
          </div>
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const profiles = value.profiles.some((profile) => profile.id === editing.id)
                  ? value.profiles.map((profile) => (profile.id === editing.id ? editing : profile))
                  : [...value.profiles, editing];
                if (update({ profiles, selectedId: editing.id })) setEditing(null);
              }}
            >
              <label>
                Environment name
                <input
                  ref={nameRef}
                  required
                  maxLength={80}
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
              </label>
              {editing.variables.map((variable, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: editable variable rows have positional identity and are never reordered
                <div className="pp-http-variable-row" key={`${editing.id}-${index}`}>
                  <input
                    aria-label={`Variable name ${index + 1}`}
                    required
                    pattern="[A-Za-z_][A-Za-z0-9_]{0,63}"
                    maxLength={64}
                    value={variable.name}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        variables: editing.variables.map((entry, i) =>
                          i === index ? { ...entry, name: event.target.value } : entry
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`Variable value ${index + 1}`}
                    type={isHTTPSecretVariable(variable) ? 'password' : 'text'}
                    autoComplete="off"
                    maxLength={8192}
                    value={variable.value}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        variables: editing.variables.map((entry, i) =>
                          i === index ? { ...entry, value: event.target.value } : entry
                        ),
                      })
                    }
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={isHTTPSecretVariable(variable)}
                      disabled={isHTTPSecretVariable({ ...variable, secret: false })}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          variables: editing.variables.map((entry, i) =>
                            i === index ? { ...entry, secret: event.target.checked } : entry
                          ),
                        })
                      }
                    />
                    Secret
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove variable ${index + 1}`}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        variables: editing.variables.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="pp-http-tools-actions">
                <button
                  type="button"
                  disabled={editing.variables.length >= 32}
                  onClick={() =>
                    setEditing({
                      ...editing,
                      variables: [...editing.variables, { name: '', value: '', secret: false }],
                    })
                  }
                >
                  Add variable
                </button>
                <button type="submit">Save environment</button>
                <button type="button" onClick={() => setEditing(null)}>
                  Discard edits
                </button>
                {value.profiles.some((profile) => profile.id === editing.id) ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        update({
                          profiles: value.profiles.filter((profile) => profile.id !== editing.id),
                          selectedId: value.selectedId === editing.id ? '' : value.selectedId,
                        })
                      )
                        setEditing(null);
                    }}
                  >
                    Delete environment
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem(httpEnvironmentsKey);
                    setValue({ profiles: [], selectedId: '' });
                    setError('');
                    setNotice('Profiles cleared.');
                  } catch {
                    setError('Browser storage is unavailable.');
                  }
                }}
              >
                Reset environment profiles
              </button>
            </>
          ) : null}
        </section>
      ) : error ? (
        <span role="alert">{error}</span>
      ) : null}
    </div>
  );
}
