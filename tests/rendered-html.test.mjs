import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the ERRANTE game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>ERRANTE: O Dorso do Mundo<\/title>/i);
  assert.match(html, /ERRANTE/);
  assert.match(html, /Novo jogo/);
  assert.match(html, /Configurações/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships accessible Portuguese metadata", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /<html[^>]+lang="pt-BR"/i);
  assert.match(html, /Uma vertical slice 3D de sobrevivência/i);
  assert.match(html, /aria-label="Silhueta do colosso migratório no oceano"/i);
});
