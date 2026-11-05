const test = require("node:test");
const assert = require("node:assert");
const { createServer } = require("../server");

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = createServer().listen(0, async () => {
      try {
        await fn(`http://127.0.0.1:${server.address().port}`);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

test("GET /healthz returns ok", () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "ok");
  }));

test("GET /api/info returns build info", () =>
  withServer(async (base) => {
    const body = await (await fetch(`${base}/api/info`)).json();
    assert.ok("commit" in body);
  }));

test("GET / returns HTML", () =>
  withServer(async (base) => {
    const res = await fetch(base);
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /Secretless Deploy Lab/);
  }));
