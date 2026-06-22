// Simple mock node server used by e2e containerized tests
const http = require('http')

const PORT = process.env.PORT || 4000
const NODE_ID = process.env.NODE_ID || 'node-x'
// Entities this mock owns, comma-separated
const OWNS = (process.env.OWNS || '').split(',').filter(Boolean)

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/ownership')) {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const entity = url.searchParams.get('entity')
    const owns = OWNS.includes(entity)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ nodeId: NODE_ID, owns }))
    return
  }

  if (req.url.startsWith('/sse')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    let i = 0
    const iv = setInterval(() => {
      sendSSE(res, { nodeId: NODE_ID, seq: i++ })
    }, 500)

    req.on('close', () => {
      clearInterval(iv)
    })
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('ok')
})

server.listen(PORT, () => {
  console.log(`mock-node ${NODE_ID} listening on ${PORT}, owns=${OWNS.join(',')}`)
})
