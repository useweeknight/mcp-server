// 极简 HTTP 服务，监听 8080（Cloud Run 约定）
import http from 'node:http';

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Weeknight MCP server is up!\n');
});

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
