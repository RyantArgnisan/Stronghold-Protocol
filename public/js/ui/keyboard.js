// Shared guard for global keyboard listeners; capture handlers must not steal IME/text input.
export function isTextEntry(target) {
  const tag = typeof target?.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable
    || !!target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export function isTypingEvent(event) {
  return !!event?.isComposing || event?.keyCode === 229 || isTextEntry(event?.target) || !!event?.target?.closest?.('.chat');
}

// Dialogs still own focus navigation and dismissal from editable controls (except during IME).
export function isDialogTypingEvent(event) {
  if (event?.isComposing || event?.keyCode === 229) return true;
  return event?.key !== 'Tab' && event?.key !== 'Escape' && isTypingEvent(event);
}
