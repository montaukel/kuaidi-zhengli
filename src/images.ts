export async function optimizeImage(file: File) {
  const bitmap = await createImageBitmap(file)
  const maxWidth = 1440
  const scale = Math.min(1, maxWidth / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return file.slice(0, file.size, file.type)
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file.slice(0, file.size, file.type)), 'image/jpeg', 0.84)
  })
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function dataUrlToBlob(value: string) {
  const [header, encoded] = value.split(',')
  if (!header?.startsWith('data:image/') || !encoded) throw new Error('invalid image')
  const mime = header.match(/^data:([^;]+)/)?.[1] ?? 'image/jpeg'
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: mime })
}
