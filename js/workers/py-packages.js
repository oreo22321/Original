// ライブラリの名前の対応 (python-worker と pytools-worker で使う)
// import 名 → PyPI の名前 (違うものだけ。Pyodide にあるもの (numpy など) は Pyodide が知っています)
export const PIP_NAMES = {
  bs4: 'beautifulsoup4', dotenv: 'python-dotenv', jwt: 'PyJWT', docx: 'python-docx', pptx: 'python-pptx', serial: 'pyserial',
  slugify: 'python-slugify', dateutil: 'python-dateutil', yaml: 'pyyaml', PIL: 'pillow', sklearn: 'scikit-learn', skimage: 'scikit-image',
  cv2: 'opencv-python', Crypto: 'pycryptodome', Cryptodome: 'pycryptodomex', OpenSSL: 'pyopenssl', attr: 'attrs', magic: 'python-magic',
  jose: 'python-jose', multipart: 'python-multipart', fitz: 'pymupdf', websocket: 'websocket-client', pkg_resources: 'setuptools',
  sentence_transformers: 'sentence-transformers', Levenshtein: 'levenshtein', github: 'PyGithub', googletrans: 'googletrans',
  wikipedia: 'wikipedia', emoji: 'emoji', termcolor: 'termcolor', colorama: 'colorama', tabulate: 'tabulate', faker: 'Faker',
  markdown: 'markdown', toml: 'toml', ujson: 'ujson', simplejson: 'simplejson', more_itertools: 'more-itertools', typing_extensions: 'typing-extensions',
}
// ブラウザでは動かないもの (入れようとせず、理由を伝える)
export const NO_PIP = {
  tkinter: 'tkinter (ウィンドウを出す GUI) はブラウザでは使えません。絵や簡単なゲームは turtle、グラフは matplotlib で作れます',
  PyQt5: 'PyQt (ウィンドウを出す GUI) はブラウザでは使えません', PyQt6: 'PyQt (ウィンドウを出す GUI) はブラウザでは使えません',
  PySide2: 'PySide (ウィンドウを出す GUI) はブラウザでは使えません', PySide6: 'PySide (ウィンドウを出す GUI) はブラウザでは使えません',
  wx: 'wxPython (ウィンドウを出す GUI) はブラウザでは使えません', kivy: 'kivy (アプリの画面) はブラウザでは使えません',
  pyautogui: 'pyautogui (パソコンの操作) はブラウザでは使えません', pynput: 'pynput (キーボード・マウスの操作) はブラウザでは使えません',
  keyboard: 'keyboard (キーボードの操作) はブラウザでは使えません', mouse: 'mouse (マウスの操作) はブラウザでは使えません',
  pygame: 'pygame の画面 (ウィンドウ) はこの環境ではまだ表示できません。ゲームは turtle (onkey・ontimer) で作れます',
  selenium: 'selenium (ブラウザの自動操作) はこの環境では使えません', discord: 'discord.py (常時接続の通信) はブラウザでは使えません',
  telegram: 'Telegram のボット (常時接続の通信) はブラウザでは使えません', torch: 'PyTorch はブラウザでは使えません',
  tensorflow: 'TensorFlow はブラウザでは使えません',
}

// Pyodide に用意されているライブラリの置き場所 (python-worker の CDN と同じ)
export const PYODIDE_VERSION = '314.0.8'
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
