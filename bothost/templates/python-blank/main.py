# 何でも動かせます (Discord 以外の bot や、定期的に動かす処理など)
import time
from datetime import datetime

print("起動しました")
while True:
    print(datetime.now().strftime("%H:%M:%S"), "動いています")
    time.sleep(10)
