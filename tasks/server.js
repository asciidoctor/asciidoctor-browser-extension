import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5678
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
}

const server = createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname
  const filePath = normalize(join(ROOT, urlPath))
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403)
    res.end()
    return
  }
  try {
    const content = await readFile(filePath)
    const contentType =
      MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end()
  }
})

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
