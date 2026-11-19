// ForgeCode の Python に置く道具をまとめる (python-worker と pytools-worker で同じものを使う)
// _forgecode・turtle・pygame・tkinter・multiprocessing・webbrowser・winsound・playsound
import { runtimeFiles, FC_LIB } from './py-runtime.js'
import { TURTLE } from './py-turtle.js'
import { pygameFiles } from './py-pygame.js'
import { tkinterFiles } from './py-tkinter.js'

export { FC_LIB }
// ForgeCode が用意しているので、Pyodide や PyPI から入れないもの
export const SHIMS = new Set(['pygame', 'tkinter', '_tkinter', 'turtle', 'webbrowser', 'multiprocessing', 'winsound', 'playsound'])
export function libFiles() {
  return { ...runtimeFiles(TURTLE), ...pygameFiles(), ...tkinterFiles() }
}
