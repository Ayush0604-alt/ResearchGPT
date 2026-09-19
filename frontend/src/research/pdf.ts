// PDFs sent to the model travel inline (base64) in the request, which providers
// cap at about 20 MB in total; stay well below that.
export const MAX_PDF_BYTES = 15 * 1024 * 1024

export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  // Chunked: String.fromCharCode(...hugeArray) overflows the call stack.
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
