// 复用阅读端解码器；显式传入 CompiledWasm，避免包内尝试通过 URL 获取 wasm。
import { init as init_jpeg, default as decode_jpeg } from "@jsquash/jpeg/decode.js";
import { init as init_png, decode as decode_png } from "@jsquash/png/decode.js";
import { init as init_webp, default as decode_webp } from "@jsquash/webp/decode.js";
import jpeg_wasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import png_wasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import webp_wasm from "@jsquash/webp/codec/dec/webp_dec.wasm";

/**
 * content-type 白名单 → 解码器。GIF/AVIF/SVG/BMP 刻意不在表内（体积或安全性），
 * 不支持的格式由调用方保留原图与可读的宽高。
 * @type {Record<string, { init: (module: unknown) => Promise<void>, decode: (bytes: ArrayBuffer) => Promise<{ data: Uint8ClampedArray, width: number, height: number }>, wasm: unknown }>}
 */
const decoders = {
  "image/jpeg": { init: init_jpeg, decode: decode_jpeg, wasm: jpeg_wasm },
  "image/jpg": { init: init_jpeg, decode: decode_jpeg, wasm: jpeg_wasm },
  "image/png": { init: init_png, decode: decode_png, wasm: png_wasm },
  "image/webp": { init: init_webp, decode: decode_webp, wasm: webp_wasm },
};

/** 每个编码器的 init promise。判「已初始化」用它，而不是编码器内部的单例标记。 */
/** @type {Map<string, Promise<void>>} */
const initialized = new Map();

/** @param {unknown} content_type @returns {string} */
export function decodable_content_type(content_type) {
  const essence = String(content_type ?? "").split(";")[0].trim().toLowerCase();
  return essence in decoders ? essence : "";
}

/**
 * @param {string} essence
 * @returns {Promise<{ init: Function, decode: Function, wasm: unknown }>}
 */
async function ready_decoder(essence) {
  const decoder = decoders[essence];
  let pending = initialized.get(essence);
  if (pending === undefined) {
    // `CompiledWasm` 规则没生效时 import 的就不是 Module，各编码器会在 instantiateWasm
    // 里抛错——**回调里的异常不会让 init 的 promise 结算**，请求就挂住了。宁可在这里
    // 显式失败，让快照退回只有宽高。
    if (!(decoder.wasm instanceof WebAssembly.Module)) {
      return Promise.reject(
        new Error("封面解码器 wasm 未被编译成 WebAssembly.Module（检查 wrangler.jsonc 的 CompiledWasm 规则）"),
      );
    }
    pending = decoder.init(decoder.wasm);
    initialized.set(essence, pending);
  }
  await pending;
  return decoder;
}

/**
 * 解码一张图片为 RGBA。认不出的类型回 `null`（调用方按「只有宽高」处理）。
 *
 * 调用方串行调用，并在解码前限制像素数，避免超出 Worker 内存预算。
 * @param {Uint8Array} bytes
 * @param {unknown} content_type
 * @returns {Promise<{ data: Uint8ClampedArray, width: number, height: number } | null>}
 */
export async function decode_image(bytes, content_type) {
  const essence = decodable_content_type(content_type);
  if (essence === "" || !(bytes instanceof Uint8Array) || bytes.length === 0) return null;
  const decoder = await ready_decoder(essence);
  // 各 jsquash decode 要 ArrayBuffer（png 内部自己再包一层 Uint8Array）。
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const image = await decoder.decode(buffer);
  if (!image || !(image.width > 0) || !(image.height > 0)) return null;
  return { data: image.data, width: image.width, height: image.height };
}
