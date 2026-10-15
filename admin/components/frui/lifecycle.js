/** Timeless View 的 onUnmounted 不销毁子树，永久卸载时改走完整 destroy。 */
function destroy_on_unmount(view, onUnmounted) {
  const destroy = view.destroy.bind(view);
  let disposed = false;
  view.destroy = view.onUnmounted = () => {
    if (disposed) return;
    disposed = true;
    destroy();
    onUnmounted?.();
  };
  return view;
}

export {
  destroy_on_unmount
};
