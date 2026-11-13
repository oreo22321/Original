// 端末内 LLM を画面とは別のスレッドで動かす (画面が固まらないように)
import { WebWorkerMLCEngineHandler } from '../../vendor/web-llm.js'

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = msg => handler.onmessage(msg)
