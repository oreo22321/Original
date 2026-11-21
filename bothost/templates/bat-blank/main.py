import time

print("こんにちは！ start.bat から起動しました")
for i in range(3):
    print(f"動いています… {i + 1}")
    time.sleep(1)
print("おわり")
