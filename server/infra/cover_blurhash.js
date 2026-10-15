import { encode } from "blurhash";

// 与阅读端共用 64px 盒式降采样和 4×3 BlurHash 分量约定。
export function downsample_rgba(rgba, width, height, max_edge) {
  const edge = Math.max(1, Math.floor(Number(max_edge) || 0));
  if (!(width > 0) || !(height > 0)) {
    return { data: rgba, width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  if (longest <= edge) return { data: rgba, width, height };
  const scale = edge / longest;
  const dst_width = Math.max(1, Math.floor(width * scale));
  const dst_height = Math.max(1, Math.floor(height * scale));
  const output = new Uint8ClampedArray(dst_width * dst_height * 4);
  for (let y = 0; y < dst_height; y += 1) {
    // 边界用比例反算而不是累加步长，否则除不尽时最后一行会少覆盖几个源像素。
    const y0 = Math.floor((y * height) / dst_height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / dst_height));
    for (let x = 0; x < dst_width; x += 1) {
      const x0 = Math.floor((x * width) / dst_width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / dst_width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        let source = (sy * width + x0) * 4;
        for (let sx = x0; sx < x1; sx += 1) {
          r += rgba[source];
          g += rgba[source + 1];
          b += rgba[source + 2];
          a += rgba[source + 3];
          count += 1;
          source += 4;
        }
      }
      const target = (y * dst_width + x) * 4;
      output[target] = Math.round(r / count);
      output[target + 1] = Math.round(g / count);
      output[target + 2] = Math.round(b / count);
      output[target + 3] = Math.round(a / count);
    }
  }
  return { data: output, width: dst_width, height: dst_height };
}


export function encode_cover_blurhash(image) {
  const small = downsample_rgba(image.data, image.width, image.height, 64);
  return encode(small.data, small.width, small.height, 4, 3);
}
