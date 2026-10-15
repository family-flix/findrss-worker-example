function ShortcutModel(now = Date.now) {
  const handlers = new Map();
  let previous_code = "";
  let previous_at = 0;
  function reset() {
    previous_code = "";
    previous_at = 0;
  }
  return {
    clear() { handlers.clear(); reset(); },
    register(bindings) {
      for (const [keys, handler] of Object.entries(bindings))
        for (const key of keys.split(","))
          handlers.set(key.trim().replace(/(Control|Meta|Alt|Shift)(Left|Right)/g, "$1"), handler);
    },
    handle_keydown(event) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !event.code) {
        reset();
        return false;
      }
      if (/^(Control|Meta|Alt|Shift)(Left|Right)$/.test(event.code)) {
        reset();
        return false;
      }
      const modifiers = [
        event.ctrlKey && "Control", event.metaKey && "Meta",
        event.altKey && "Alt", event.shiftKey && "Shift",
      ].filter(Boolean);
      const code = [...modifiers, event.code].join("+");
      const at = now();
      const sequence = !modifiers.length && !event.repeat && at - previous_at <= 200
        ? previous_code + code : "";
      previous_code = event.repeat ? "" : code;
      previous_at = at;
      const handler = handlers.get(code) || handlers.get(sequence);
      if (!handler || handler(event) === false) return false;
      if (handlers.has(sequence)) reset();
      event.preventDefault();
      return true;
    },
    reset,
  };
}

export { ShortcutModel };
