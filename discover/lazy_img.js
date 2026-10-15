import { combine, Img, ref, Show, View } from "timeless";
import { decode } from "blurhash";

function placeholder_url(hash, width, height) {
  let content = '<rect width="100%" height="100%" fill="#1a1f2a"/>';
  if (hash) {
    try {
      const edge = 16;
      const pixels = decode(hash, edge, edge);
      const bytes = new Uint8Array(54 + edge * edge * 3);
      const view = new DataView(bytes.buffer);
      bytes.set([66, 77]);
      view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true);
      view.setUint32(14, 40, true); view.setInt32(18, edge, true); view.setInt32(22, -edge, true);
      view.setUint16(26, 1, true); view.setUint16(28, 24, true);
      for (let i = 0; i < edge * edge; i++) bytes.set([pixels[i * 4 + 2], pixels[i * 4 + 1], pixels[i * 4]], 54 + i * 3);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      content = `<image href="data:image/bmp;base64,${btoa(binary)}" width="100%" height="100%" preserveAspectRatio="none"/>`;
    } catch { /* 损坏的 BlurHash 保留纯色占位。 */ }
  }
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`);
}

export function LazyImgModel({ src, blurhash = "", width = 0, height = 0 }) {
  const exposed = ref(false), loaded = ref(false), failed = ref(false);
  const image_width = Math.max(1, Math.min(100000, Number(width) || 4)), image_height = Math.max(1, Math.min(100000, Number(height) || 3));
  return {
    state: { exposed, loaded, failed, status: combine({ loaded, failed }, ({ loaded, failed }) => failed ? "error" : loaded ? "loaded" : "pending"),
      placeholder: placeholder_url(blurhash, image_width, image_height), width: image_width, height: image_height, src },
    methods: {
      expose() { if (src && !failed.value) exposed.set(true); },
      load() { loaded.set(true); },
      error() { failed.set(true); loaded.set(false); },
    },
  };
}

export function LazyAvatar({ src, initial }) {
  const model = LazyImgModel({ src, width: 40, height: 40 });
  return View({
    class: "feed-avatar feed-avatar-initial lazy-avatar",
    attributes: { n: "feed-avatar", "aria-hidden": "true", "data-lazy-img-state": model.state.status },
    onExpose: model.methods.expose,
  }, [
    View({ class: "lazy-avatar-initial", attributes: { n: "feed-avatar-placeholder" } }, [initial]),
    Show({ when: model.state.exposed, ok() {
      return Img({ class: "lazy-avatar-image", src: model.state.src,
        attributes: { n: "feed-avatar-image", alt: "", decoding: "async", width: 40, height: 40 },
        onLoad: model.methods.load, onError: model.methods.error });
    } }),
  ]);
}

export function LazyImg(props) {
  const model = LazyImgModel(props);
  return View({
    class: "feed-article-cover lazy-img",
    attributes: { n: "feed-article-cover-frame", "data-lazy-img-state": model.state.status },
    onExpose: model.methods.expose,
  }, [
    Img({ class: "lazy-img-placeholder", src: model.state.placeholder,
      attributes: { n: "feed-article-cover-placeholder", alt: "", "aria-hidden": "true", width: model.state.width, height: model.state.height } }),
    Show({ when: model.state.exposed, ok() {
      return Img({ class: "lazy-img-image", src: model.state.src,
        attributes: { n: "feed-article-cover", alt: "", decoding: "async", width: model.state.width, height: model.state.height },
        onLoad: model.methods.load, onError: model.methods.error });
    } }),
  ]);
}
