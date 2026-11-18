// テスト用: python-worker.js を Node の worker_threads で動かす (画面の代わりにテストが指示を出す)
import { parentPort } from 'node:worker_threads'
globalThis.self = globalThis
globalThis.postMessage = m => parentPort.postMessage(m)
parentPort.on('message', m => globalThis.onmessage({ data: m }))
await import('../js/workers/python-worker.js')
