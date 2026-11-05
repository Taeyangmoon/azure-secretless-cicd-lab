const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function loadBuildInfo() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "build-info.json"), "utf8")
    );
  } catch {
    return { commit: "local", runId: "-", actor: "-", builtAt: "-" };
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function renderPage(info) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Secretless Deploy Lab</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#0b1220; color:#e6edf3; display:grid; place-items:center; min-height:100vh; margin:0; }
    main { max-width:560px; padding:2rem; background:#111a2e; border-radius:12px; }
    h1 { margin-top:0; }
    code { background:#1c2a4a; padding:2px 6px; border-radius:4px; }
    td { padding:4px 12px 4px 0; }
  </style>
</head>
<body>
  <main>
    <h1>🔐 Secretless Deploy Lab</h1>
    <p>이 앱은 비밀번호·키 없이(OIDC) GitHub Actions로 배포되었습니다.<br>
       This app was deployed by GitHub Actions without any stored secret (OIDC).</p>
    <table>
      <tr><td>Commit</td><td><code>${escapeHtml(info.commit)}</code></td></tr>
      <tr><td>Run ID</td><td><code>${escapeHtml(info.runId)}</code></td></tr>
      <tr><td>Actor</td><td><code>${escapeHtml(info.actor)}</code></td></tr>
      <tr><td>Built at</td><td><code>${escapeHtml(info.builtAt)}</code></td></tr>
    </table>
  </main>
</body>
</html>`;
}

function createServer() {
  return http.createServer((req, res) => {
    const info = loadBuildInfo();
    const { pathname } = new URL(req.url, "http://localhost");

    if (pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    if (pathname === "/api/info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(info));
    }
    if (pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPage(info));
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
}

if (require.main === module) {
  const port = process.env.PORT || 8080;
  createServer().listen(port, () => console.log(`Listening on ${port}`));
}

module.exports = { createServer };
