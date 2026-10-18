export function realtime_fixture() {
  const listeners = new Set();
  return {
    listeners,
    subscribe(topics, receive) {
      const entry = { topics: Array.isArray(topics) ? topics : [topics], receive };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    async emit(event) {
      for (const entry of [...listeners]) if (event.type.startsWith("realtime.") || entry.topics.includes(event.type)) entry.receive(event);
      await new Promise(setImmediate);
    },
  };
}
