export function useEnterSubmit(onSubmit, canSubmit = true) {
  return (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'textarea' || event.target?.isContentEditable) return;
    if (!canSubmit) return;
    event.preventDefault();
    onSubmit(event);
  };
}
