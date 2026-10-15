// 小说页面可能以 GBK 返回；HTTP charset 优先，缺省再读取 HTML meta。
export function rss_response_text(buffer, content_type = "") {
  const prefix = new TextDecoder().decode(new Uint8Array(buffer).subarray(0, 1024));
  const charset = content_type.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1] ||
    prefix.match(/<meta\b[^>]*charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1] || "utf-8";
  return new TextDecoder(["gbk", "gb2312", "gb18030"].includes(charset.toLowerCase()) ? charset : "utf-8").decode(buffer);
}
