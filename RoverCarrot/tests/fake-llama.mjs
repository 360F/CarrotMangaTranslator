#!/usr/bin/env node
import { createServer } from 'node:http';
const args = process.argv.slice(2);
if (args.includes('--list-devices')) { console.log('CUDA0: NVIDIA Fake GPU'); process.exit(0); }
const port = Number(args[args.indexOf('--port') + 1]);
if (process.env.FAKE_LLAMA_FAIL) process.exit(7);
let interrupted = false;
function interrupt(signal) {
  console.log(`interrupt:${signal}`);
  if (process.env.FAKE_LLAMA_STUBBORN) return;
  if (interrupted) { console.error('Received second interrupt, terminating immediately'); process.exit(1); }
  interrupted = true;
  // Model real cleanup lasting longer than the former 250ms grace period.
  setTimeout(() => process.exit(0), Number(process.env.FAKE_LLAMA_CLEANUP_MS ?? 350));
}
process.on('SIGINT', () => interrupt('SIGINT'));
process.on('SIGTERM', () => interrupt('SIGTERM'));
let calls = 0;
const server = createServer(async (req, res) => {
  let text = ''; for await (const b of req) text += b;
  if (req.url === '/v1/models') {
    res.statusCode = process.env.FAKE_LLAMA_NOT_READY ? 503 : 200; res.end('{"data":[]}'); return;
  }
  if (req.url.endsWith('/tokenize')) { res.end('{"tokens":[49]}'); return; }
  if (req.url === '/v1/chat/completions') {
    const body = JSON.parse(text); calls++;
    if (body.logit_bias?.['49'] !== -100) { res.statusCode = 400; res.end('missing forbidden-token bias'); return; }
    const options = body.messages.at(-1).content.at(-1).text;
    if (!options.includes('OCR candidates')) { res.statusCode = 400; res.end('missing OCR'); return; }
    const output = process.env.FAKE_LLAMA_EMPTY && calls === 1 ? '[]' : `id: 1\ntype: nonsolid\ntextRole: ordinary\nx1: 100\ny1: 100\nx2: 400\ny2: 400\ndirection: vertical\nangle: 0\nfontSize: 20\nconfidence: 0.99\njp: 太郎\nko: 타로\n<page-context>{"visualSummary":"타로가 말한다","glossary":[{"source":"太郎","target":"타로","category":"character"}],"characters":[]}</page-context>`;
    res.end(JSON.stringify({ choices: [{ message: { content: output } }], usage: { total_tokens: 20 } })); return;
  }
  res.statusCode = 404; res.end('{}');
});
server.listen(port, '127.0.0.1');
