// テスト用: eval を使わないインタプリタで実行する (node --import ./tests/force-interp.mjs tests/xxx.test.mjs)
import { forceInterpreter } from '../js/luau/compiler.js'
forceInterpreter(true)
