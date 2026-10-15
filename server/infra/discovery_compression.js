export async function gzip_html(html) {
  const stream = new Response(html).body.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function stored_html(object) {
  if (!object) return "";
  if (object.httpMetadata?.contentEncoding !== "gzip") return object.text();
  const stream = new Response(object.body).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export function accepts_gzip(header) {
  const encodings = new Map(String(header || "").toLowerCase().split(",").map(part => {
    const [name, ...parameters] = part.split(";");
    const weight = parameters.find(value => /^\s*q\s*=/.test(value));
    const quality = weight ? Number(weight.split("=")[1]) : 1;
    return [name.trim(), quality > 0 && quality <= 1];
  }));
  return encodings.get("gzip") ?? encodings.get("*") ?? false;
}
