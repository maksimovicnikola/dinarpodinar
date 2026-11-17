const listeners = new Set<() => void>();

export function onEntriesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyEntriesChanged(): void {
  for (const listener of listeners) listener();
}
