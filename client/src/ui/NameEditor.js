// An HTML <input> floated over the canvas to rename a block in place —
// the canvas can't host a real text caret, and a full modal for a single
// short field would be heavier than the edit itself. Positioned in screen
// coordinates by whoever opens it (main.js converts the block's world rect
// via the camera), so it sits exactly over the name it's editing.
export function createNameEditor({ onCommit, allowEmpty = false }) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'name-editor';
  input.hidden = true;
  document.body.appendChild(input);

  let editingId = null;
  // Escape has to suppress the commit that blur would otherwise trigger on
  // its way out, so cancelling doesn't save the half-typed value anyway.
  let cancelled = false;

  function close() {
    editingId = null;
    input.hidden = true;
  }

  function commit() {
    if (editingId === null || cancelled) return;
    const id = editingId;
    const value = input.value.trim();
    close();
    // A block always needs some name, so an empty commit there is ignored
    // rather than left blank. A wire's label is optional — allowEmpty lets
    // that same commit clear one back out, rather than the only way to
    // remove a label being some separate control.
    if (value || allowEmpty) onCommit(id, value);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelled = true;
      input.blur();
      close();
    }
    // Editing a name shouldn't also reach the canvas's own Delete/Backspace
    // "remove the selected block" shortcut.
    event.stopPropagation();
  });

  return {
    isOpen: () => editingId !== null,
    // `rect` is in screen (CSS pixel) coordinates, already converted from
    // world space by the caller.
    open(blockId, name, rect) {
      editingId = blockId;
      cancelled = false;
      input.value = name;
      input.hidden = false;
      input.style.left = `${rect.x}px`;
      input.style.top = `${rect.y}px`;
      input.style.width = `${Math.max(80, rect.width)}px`;
      input.style.height = `${Math.max(24, rect.height)}px`;
      input.focus();
      input.select();
    },
    close,
  };
}
